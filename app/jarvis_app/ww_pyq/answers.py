"""His answers kept beside the questions of an evening sheet, and a mark proposed for each (wave EW13 A1 and A2, R-78 to R-84).

    load / list_answers / public / agreement      the answers of one sheet and how far his accepted proposals moved
    put_text(store, sheet, qid, text)              what he typed: "typed", or "corrected" over text read from a picture
    photo_kind(head) / add_photo(...)              one JPEG or PNG, told by its first bytes; 10 MB, 6 a question
    photo_file / delete                            one picture back; the answer and its pictures removed
    read(store, sheet, qid, reader, replace)       the pictures through the OCR reader, with the engine's mean confidence
    check(store, sheet, qid, model, busy)          a proposal: the rule of R-26 for a numerical question with a key, else
                                                   the rubric's points judged by the model and every quote looked up
    accept(store, plan, sid, qid, body, at, day)   the mark written through the same check as R-58

Where it lives: tonight/answers/<sheet id>/<question id>.json and tonight/answers/<sheet id>/<question id>/<n>.jpg|png
under the pyq store, beside tonight/why/, never inside sheets/ (the ledger reads every sheets/*.json as a sheet). The
sheet id reaches a path only through tonight.check_sheet_id, the question id only when it is a question of that sheet,
and a picture's name is made here from its number and kind, never from the request.

What is never done: a proposal is never a mark (only accept() writes one); `got` of a rubric proposal is the sum of the
marks of the points met and nothing else; a point the model calls met counts only when the words it quotes are in his
answer; a numerical question with a key is checked by check.check_numeric alone and no marks are proposed for its
working. Every value says who set it: the text by "typed", "ocr" or "corrected", a proposal by "rule" or the model's
name, a mark by "proposal" or "hand".
"""
from __future__ import annotations

import json
import re
import threading
from pathlib import Path
from typing import Any, Callable, Optional

from .. import ww_counsel
from . import api, check as chk, drafts, rubric, settings, tonight
from .blueprint import write_json_atomic

ANSWERS = "answers"                 # under tonight/
MAX_TEXT = 20_000                   # an end-semester long answer runs 600 to 1,500 words, about 9,000 characters
MAX_PHOTO = 10 * 1024 * 1024        # a phone's 12 Mpx JPEG is 3 to 5 MB; 10 MB leaves room, and caps a hostile body
MAX_PHOTOS = 6                      # a 10-mark answer fills 2 to 4 pages; 6 a question
TEXT_STATUSES = ("typed", "ocr", "corrected", "not read")
_JPEG, _PNG = b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n"
_EXT = {"jpeg": "jpg", "png": "png"}
_MEDIA = {"jpg": "image/jpeg", "png": "image/png"}
_QID = re.compile(r"^[a-z]-[a-z0-9-]{1,40}$")     # the store's own id shape (ww_pyq/store.py _ID)
_LOCK = threading.RLock()           # every read-modify-write of an answer file; taken after tonight._LOCK, never before
_reading = threading.Lock()         # one OCR reading of answers at a time (R-82)
_NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*[x×*]\s*10\s*\^\s*\{?\s*[+-]?\d+\s*\}?)?"
                     r"(?:\s*/\s*\d+(?:\.\d*)?)?(?:\s*[A-Za-zΩΩµμ%°][A-Za-zΩΩµμ%°/^0-9]{0,11})?")


def _g(x: Any) -> str:
    return format(float(x), "g")


def _num(x: float) -> Any:
    return int(x) if float(x) == int(x) else round(float(x), 2)


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


# ------------------------------------------------------------------ paths
def _root(store, sid: str) -> Path:
    return Path(store.root) / tonight.DIR / ANSWERS / tonight.check_sheet_id(sid)


def item_of(sheet: dict, qid: Any) -> dict:
    """The sheet's item for a question id; anything else is an unknown answer (404), never a path."""
    if isinstance(qid, str) and _QID.match(qid):
        for it in sheet.get("items") or []:
            if it.get("question_id") == qid:
                return it
    raise KeyError("That question is not on this sheet.")


def _inside(base: Path, p: Path) -> Path:
    """The path stays under the sheet's answers folder, whatever was asked (the ids are checked already; this is the
    second lock on the same door)."""
    if not p.resolve().is_relative_to(base.resolve()):
        raise KeyError("No such answer.")
    return p


def _path(store, sid: str, qid: str) -> Path:
    base = _root(store, sid)
    return _inside(base, base / f"{qid}.json")


def _photo_dir(store, sid: str, qid: str) -> Path:
    base = _root(store, sid)
    return _inside(base, base / qid)


def _photo_path(store, sid: str, qid: str, n: int) -> Optional[Path]:
    d = _photo_dir(store, sid, qid)
    for ext in _MEDIA:
        p = d / f"{int(n)}.{ext}"
        if p.is_file():
            return _inside(_root(store, sid), p)
    return None


# ------------------------------------------------------------------ records
class AnswerFileFault(RuntimeError):
    """An answer file that is there but cannot be read: the routes answer state fault and nothing writes over it, so a
    blank record never lands on top of his pictures."""


def load(store, sid: str, qid: str) -> Optional[dict]:
    """The answer on file, None when there is none, AnswerFileFault when its file is there but broken."""
    p = _path(store, sid, qid)
    try:
        raw = p.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError:
        raise AnswerFileFault("The answer file of this question could not be read; it was left as it is.") from None
    try:
        d = json.loads(raw)
    except ValueError:
        d = None
    if not isinstance(d, dict) or d.get("question_id") != qid:
        raise AnswerFileFault("The answer file of this question could not be read; it was left as it is.")
    return d


def _save(store, sid: str, rec: dict) -> dict:
    p = _path(store, sid, rec["question_id"])
    p.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(p, rec)
    return rec


def _blank(qid: str, at: str) -> dict:
    return {"question_id": qid, "text": "", "text_status": "not read", "photos": [], "at": at}


def public(rec: dict) -> dict:
    """The R-78 shape of one answer: {question_id, text, text_status, photos, confidence?, proposal?, at}, and once he
    accepted a mark, `accepted` and `mark_origin`."""
    out = {"question_id": rec["question_id"], "text": rec.get("text") or "", "text_status": rec.get("text_status") or "not read",
           "photos": [{"n": p["n"], "bytes": p["bytes"], "at": p["at"]} for p in rec.get("photos") or []], "at": rec.get("at")}
    for k in ("confidence", "proposal", "accepted", "mark_origin"):
        if rec.get(k) is not None:
            out[k] = rec[k]
    return out


def list_answers(store, sheet: dict) -> list[dict]:
    """The answers kept for a sheet, in the sheet's order."""
    out = []
    for it in sheet.get("items") or []:
        rec = load(store, sheet["id"], it["question_id"])
        if rec is not None:
            out.append(rec)
    return out


def agreement(recs: list[dict]) -> dict:
    """How far his accepted marks moved from the proposals, over every answer whose proposal he accepted or changed.
    mean_difference is the mean of |his mark - the proposed mark| in marks (absolute, so a proposal 2 too high and one
    2 too low read as 2 apart, not as agreeing), null until there is one."""
    rows = [r["accepted"] for r in recs if isinstance(r.get("accepted"), dict) and r["accepted"].get("proposed_got") is not None]
    same = sum(1 for r in recs if r.get("mark_origin") == "proposal" and (r.get("accepted") or {}).get("proposed_got") is not None)
    diff = [abs(float(a["got"]) - float(a["proposed_got"])) for a in rows]
    return {"accepted_as_proposed": same, "changed": len(rows) - same, "count": len(rows),
            "mean_difference": round(sum(diff) / len(diff), 2) if diff else None}


def agreement_sentence(a: dict) -> str:
    if not a["count"]:
        return "No proposal accepted yet."
    md = a["mean_difference"]
    return (f"Of {_plural(a['count'], 'accepted proposal', 'accepted proposals')}, {a['accepted_as_proposed']} kept as proposed "
            f"and {a['changed']} changed; your marks were {_g(md)} {'mark' if md == 1 else 'marks'} from the proposal on average.")


# ------------------------------------------------------------------ A1: the answer kept
def put_text(store, sheet: dict, qid: str, text: Any, at: str) -> dict:
    item_of(sheet, qid)
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"The answer is 1 to {MAX_TEXT:,} characters.")
    if len(text) > MAX_TEXT:
        raise ValueError(f"The answer is 1 to {MAX_TEXT:,} characters.")
    with _LOCK:
        rec = load(store, sheet["id"], qid) or _blank(qid, at)
        read_before = rec.get("text_status") in ("ocr", "corrected")
        if text != rec.get("text"):
            rec.pop("proposal", None)            # a proposal quotes the words it was made on; new words, no proposal
        rec.update(text=text, text_status="corrected" if read_before else "typed", at=at)
        return _save(store, sheet["id"], rec)


def photo_kind(head: bytes) -> Optional[str]:
    """"jpeg" or "png" from the first bytes of the file, or None: never from a name or a content type."""
    if head[:8] == _PNG:
        return "png"
    if head[:3] == _JPEG:
        return "jpeg"
    return None


def add_photo(store, sheet: dict, qid: str, data: bytes, at: str) -> dict:
    """Keep one picture. The caller has read the body with the size cap; this checks it again with the kind."""
    item_of(sheet, qid)
    if not data:
        raise ValueError("Send one JPEG or PNG picture as the body.")
    if len(data) > MAX_PHOTO:
        raise ValueError(f"A picture is at most {MAX_PHOTO // (1024 * 1024)} MB.")
    kind = photo_kind(data[:8])
    if kind is None:
        raise ValueError("That is not a JPEG or PNG picture.")
    with _LOCK:
        rec = load(store, sheet["id"], qid) or _blank(qid, at)
        photos = list(rec.get("photos") or [])
        if len(photos) >= MAX_PHOTOS:
            raise ValueError(f"A question keeps at most {MAX_PHOTOS} pictures.")
        d = _photo_dir(store, sheet["id"], qid)
        # a number is never reused while a file of it is on disk in either kind, listed in the record or not
        on_disk = [int(f.stem) for f in (d.iterdir() if d.is_dir() else [])
                   if f.is_file() and f.stem.isdigit() and f.suffix[1:] in _MEDIA]
        n = max([int(p["n"]) for p in photos] + on_disk, default=0) + 1
        d.mkdir(parents=True, exist_ok=True)
        target = _inside(_root(store, sheet["id"]), d / f"{n}.{_EXT[kind]}")
        tmp = d / f".{n}.part"
        tmp.write_bytes(data)
        tmp.replace(target)
        photos.append({"n": n, "bytes": len(data), "at": at})
        rec.update(photos=photos, at=at)
        if not str(rec.get("text") or "").strip():
            rec["text_status"] = "not read"      # a picture with no text beside it is not read until R-82
        return _save(store, sheet["id"], rec)


def photo_file(store, sheet: dict, qid: str, n: Any) -> tuple[Path, str]:
    item_of(sheet, qid)
    if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= 99:
        raise KeyError("No such picture.")
    p = _photo_path(store, sheet["id"], qid, n)
    if p is None:
        raise KeyError("No such picture.")
    return p, _MEDIA[p.suffix[1:]]


def delete(store, sheet: dict, qid: str) -> None:
    """The answer and its pictures. A mark he accepted from it stays on the sheet: it is his mark, not the answer's."""
    item_of(sheet, qid)
    with _LOCK:
        p = _path(store, sheet["id"], qid)
        if not p.is_file():
            raise KeyError("No answer for this question on this sheet.")
        d = _photo_dir(store, sheet["id"], qid)
        if d.is_dir():
            for f in d.iterdir():
                if f.is_file():
                    f.unlink()
            d.rmdir()
        p.unlink()


# ------------------------------------------------------------------ A1: reading the pictures
def read(store, sheet: dict, qid: str, reader: Callable[[Path], dict], replace: bool, at: str) -> dict:
    """Read every picture of the answer with `reader` (ocr.read_png in the app, a fake in tests). The caller decides
    409 and waiting; this takes the reading lock itself so two reads never run at once. Returns {state, reason,
    answer, faults}."""
    from PIL import Image, ImageOps
    from . import ocr

    item_of(sheet, qid)
    rec = load(store, sheet["id"], qid)
    if rec is None or not rec.get("photos"):
        raise ValueError("No picture of this answer to read; add one first.")
    if rec.get("text_status") in ("typed", "corrected") and str(rec.get("text") or "").strip() and replace is not True:
        raise ValueError("This answer has text you typed; send {replace: true} to read the pictures over it.")
    if not _reading.acquire(blocking=False):
        raise api.Busy("OCR is reading an answer; wait for it.")
    try:
        texts, confs, faults = [], [], []
        d = _photo_dir(store, sheet["id"], qid)
        for ph in rec["photos"]:
            n = int(ph["n"])
            src = _photo_path(store, sheet["id"], qid, n)
            if src is None:
                faults.append(f"Picture {n} is gone from the folder.")
                continue
            tmp = d / f".read-{n}.png"
            try:
                with Image.open(src) as im:
                    if im.width * im.height > ocr.MAX_PIXELS:
                        faults.append(f"Picture {n} is too large to read.")
                        continue
                    # a phone keeps the turn of the picture in its EXIF tag; read sideways, a page gives no line
                    ImageOps.exif_transpose(im).convert("RGB").save(tmp, "PNG")
                res = reader(tmp)
            except ValueError:
                raise                                    # no engine: the route answers waiting
            except Exception as e:                       # one picture the engine cannot read does not end the answer
                faults.append(f"Picture {n} could not be read ({type(e).__name__}).")
                continue
            finally:
                try:
                    tmp.unlink()
                except OSError:
                    pass
            lines = [l for l in res.get("lines") or [] if str(l.get("text") or "").strip()]
            if lines:
                texts.append("\n".join(str(l["text"]).strip() for l in lines))
                confs.extend(float(l["confidence"]) for l in lines)
    finally:
        _reading.release()
    text = "\n\n".join(texts).strip()[:MAX_TEXT]
    before = (rec.get("text"), rec.get("text_status"))
    with _LOCK:
        now = load(store, sheet["id"], qid)
        if now is None:
            return {"state": "fault", "reason": "The answer was removed while its pictures were read; nothing was kept.",
                    "answer": None, "faults": faults, "ocr_text": text}
        rec = now
        if (rec.get("text"), rec.get("text_status")) != before and replace is not True:
            # he typed while the engine read (a page takes about 14 s): his words win, the read words come back to copy
            return {"state": "fault", "answer": rec, "faults": faults, "ocr_text": text,
                    "reason": "The read was not kept: you typed in this answer while the pictures were read. "
                              "The words read are in ocr_text for you to copy."}
        if not text:
            return {"state": "waiting", "reason": "OCR found no text in the pictures; type the answer instead.",
                    "answer": rec, "faults": faults}
        mean = round(sum(confs) / len(confs), 2)
        if text != rec.get("text"):
            rec.pop("proposal", None)
        rec.update(text=text, text_status="ocr", confidence=mean, at=at)
        _save(store, sheet["id"], rec)
    reason = (f"Read {_plural(len(texts), 'picture', 'pictures')} at a mean confidence of {mean:.2f}. "
              "Correct the text before you check it: OCR misreads handwriting.")
    if faults:
        reason += " " + " ".join(faults)
    return {"state": "live", "reason": reason, "answer": rec, "faults": faults}


# ------------------------------------------------------------------ A2: a mark proposed
def fold(text: str) -> str:
    """Runs of white space become one space; the letters are kept as written, case and all. The plan says a quote is
    found "letter for letter after spaces are folded", so a model that changed one letter, the case included, does not
    find its quote; folding the case too would let "Dc" stand for "DC", and a strict miss only costs him a point he can
    give back by hand."""
    return " ".join(str(text or "").split())


_QUOTE_EDGES = "\"'“”‘’`.…"                   # the marks a model wraps a quote in; inside the quote nothing is changed


# 12 characters after spaces are folded: "sampling rate" (13) or "time constant" (13), a two-word term, still stands,
# while "is the" (6), "twice" (5) or "the signal" (10) is in almost any answer and proves nothing about a point.
MIN_QUOTE = 12


def _quote_found(quote: Optional[str], answer: str) -> bool:
    if not quote:
        return False
    q = fold(quote).strip(_QUOTE_EDGES + " ")
    return len(q) >= MIN_QUOTE and q in fold(answer)


def _final_number(key: str, text: str) -> tuple[Optional[dict], Optional[str]]:
    """The check of R-26 on the number his answer ends on, read from its last line only: the whole text when it is one
    number, then the last line, what follows that line's last "=", then the last number on that line. A number further
    up is a given he copied or a step of the working (review, 28 Nov: "I0 = 5 A" in the givens matched a 5 A key), so
    it is never read. (check result, the words it read) or (None, None) when no number is found."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    cands = [text.strip()]
    if lines:
        last = lines[-1]
        cands.append(last)
        if "=" in last:
            cands.append(last.rsplit("=", 1)[1].strip())
        found = [m.group(0).strip() for m in _NUMBER.finditer(last) if m.group(0).strip()]
        if found:
            cands.append(found[-1])
    for c in cands:
        try:
            return chk.check_numeric(key, c), c
        except ValueError:
            continue
    return None, None


def numeric_key(q: dict) -> Optional[str]:
    """The question's numeric key when it has one that reads as a number (a template variant's, ww_pyq/variants.py)."""
    key = str(q.get("key") or "").strip()
    if q.get("type") != "numerical" or not key:
        return None
    try:
        r = chk.check_numeric(key, "0")
    except ValueError:
        return None
    return key if r["match"] is not None else None


def _numeric_proposal(key: str, text: str, mx: Optional[float], at: str) -> dict:
    r, words = _final_number(key, text)
    match = bool(r and r["match"])
    got = None if mx is None else (float(mx) if match else 0.0)
    if r is None:
        said = f"No number was found in your answer to compare with the key {key}."
    elif match:
        said = f"Your number {words} matches the key {key} ({r['note']})."
    else:
        said = f"Your number {words} does not match the key {key} ({r['note']})."
    if mx is None:
        said += " This question prints no marks: give out_of when you accept."
    else:
        said += f" Proposed {_g(got)} of {_g(mx)}."
    said += " No marks are proposed for the working: give them yourself when you accept. A proposal is not a mark."
    return {"status": "proposed", "basis": "number", "by": "rule", "match": match,
            "points": [{"text": f"The final number matches the key {key}", "marks": None if mx is None else _num(mx),
                        "met": match, "rests_on": words if match else None}],
            "got": None if got is None else _num(got), "max": None if mx is None else _num(mx), "sentence": said, "at": at}


def _points_text(points: list[dict]) -> str:
    return "\n".join(f"{i}. ({_g(p['marks'])} {'mark' if float(p['marks']) == 1 else 'marks'}) {p['text']}"
                     for i, p in enumerate(points, 1))


def check(store, sheet: dict, qid: str, model, busy: Callable[[], Optional[str]], at: str) -> dict:
    """{state, reason, proposal}. `model` is prep.model_for's (mode, provider, name); `busy` answers the sentence of a
    job that holds the machine, or None. The proposal is kept on the answer; nothing else is written."""
    item = item_of(sheet, qid)
    rec = load(store, sheet["id"], qid)
    text = str((rec or {}).get("text") or "")
    if not text.strip():
        raise ValueError("There is no text of your answer to check: type it, or read your pictures first.")
    q = store.get_question(qid)                          # 404 when the question is gone since the sheet was built
    mx = item.get("marks")
    key = numeric_key(q)
    if key is not None:
        prop = _numeric_proposal(key, text, mx, at)
        _keep_proposal(store, sheet["id"], qid, text, prop)
        return {"state": "live", "reason": prop["sentence"], "proposal": prop}
    rub = rubric.get(store, qid)
    if rub is None or not rub.get("points"):
        return {"state": "waiting", "proposal": None,
                "reason": (f"This question has no rubric yet: draft one with R-32 (POST /api/mission/pyq/rubric/{qid}/draft) "
                           "or write your own with R-34, then check again.")}
    if model.mode == "off" or settings.rules_only(store):
        return {"state": "planned", "proposal": None, "reason": "Rules only: no model is asked, so no mark is proposed."}
    held = busy()
    if held:
        raise api.Busy(held)
    if _reading.locked():
        raise api.Busy("OCR is reading an answer; check when it has finished.")
    if not drafts._busy.acquire(blocking=False):         # one model job at a time, shared with every draft
        raise api.Busy("The model is already working on another job; wait for it.")
    # ww_counsel.fill cuts every field at MAX_INPUT characters; the model is judged only on what it was given, and the
    # sentence says so. Quotes are still looked up in his whole text.
    seen = text[:ww_counsel.MAX_INPUT]
    try:
        if settings.rules_only(store):                   # read again at the last step: he may have switched it on since
            return {"state": "planned", "proposal": None, "reason": "Rules only: no model is asked, so no mark is proposed."}
        points = rub["points"]
        r = ww_counsel.counsel("answer_check", {"marks": _g(mx if mx is not None else rub.get("sum") or 0),
                                                "stem": q.get("text") or "", "n_points": len(points),
                                                "points": _points_text(points), "answer": seen},
                               model.provider, model.name)
    finally:
        drafts._busy.release()
    if r["status"] == "no_model":
        return {"state": "waiting", "proposal": None, "reason": "The model is not running, so no mark is proposed."}
    if r["status"] != "ok":
        return {"state": "fault", "proposal": None,
                "reason": "The model answered, but not as one verdict for each rubric point; nothing was kept."}
    verdict = {row["n"]: row for row in r["points"]}
    out, unfound = [], 0
    for i, p in enumerate(points, 1):
        v = verdict[i]
        found = v["met"] and _quote_found(v["quote"], text)
        if v["met"] and not found:
            unfound += 1                                 # the model called it met on words he did not write
        out.append({"text": p["text"], "marks": _num(p["marks"]), "met": bool(found),
                    "rests_on": fold(v["quote"]).strip(_QUOTE_EDGES + " ") if found else None})
    got = sum(float(p["marks"]) for p in out if p["met"])
    met = sum(1 for p in out if p["met"])
    said = (f"Proposed {_g(got)} of {'its marks' if mx is None else _g(mx)}: {met} of "
            f"{_plural(len(out), 'rubric point is', 'rubric points are')} met in your own words.")
    if unfound:
        said += (f" {_plural(unfound, 'point the model called met is', 'points the model called met are')} set to not met: "
                 "the words it quoted are not in your answer.")
    if rub.get("status") != "accepted":
        said += " The rubric is a draft you have not accepted yet."
    over = mx is not None and got > float(mx)
    if over:
        # a mark above the question's own is never proposed: the met points are shown, the number is his to give
        said = (f"{met} of {_plural(len(out), 'rubric point is', 'rubric points are')} met in your own words, but their "
                f"marks add up to {_g(got)}, more than the question's {_g(mx)} marks, so no mark is proposed: give it by hand."
                + said[said.index(" in your own words.") + len(" in your own words."):])
    if mx is None:
        said += " This question prints no marks: give out_of when you accept."
    if len(seen) < len(text):
        said += (f" Only the first {len(seen):,} of the {len(text):,} characters of your answer were checked: "
                 f"the model is given at most {ww_counsel.MAX_INPUT:,}.")
    said += " A proposal is not a mark until you accept it."
    if model.mode == "claude":
        said += f" The text of your answer left this PC for Claude ({model.name}) and counts against your Claude usage."
    prop = {"status": "proposed", "basis": "rubric", "by": model.name, "rubric_status": rub.get("status") or "pending",
            "points": out, "got": None if over else _num(got), "max": None if mx is None else _num(mx),
            "checked_chars": len(seen), "text_chars": len(text), "sentence": said, "at": at}
    _keep_proposal(store, sheet["id"], qid, text, prop)
    return {"state": "live", "reason": said, "proposal": prop}


def _keep_proposal(store, sid: str, qid: str, text: str, prop: dict) -> None:
    with _LOCK:
        rec = load(store, sid, qid)
        if rec is None or rec.get("text") != text:
            return                                       # his words changed while the model read them: not kept
        rec["proposal"] = prop
        _save(store, sid, rec)


# ------------------------------------------------------------------ A2: accepting it as a mark
def write_marks(plan, sheet: dict, kept: list[dict], day: str) -> dict:
    """The marks R-58 keeps, written where R-58 writes them: the topic's list in the plan's paper_marks, tagged origin
    "sheet" and the sheet id so a second post for a question replaces its own entry, oldest first, 40 kept. A faithful
    copy of the inline block in routes_ww_pyq_tonight.post_marks (no helper exists there yet); fold both into one at
    integration. Returns the proficiency of the topics touched. The caller holds tonight._LOCK."""
    from .. import ww_generator
    sid = sheet["id"]
    by_q = {it["question_id"]: it for it in sheet["items"]}
    with plan._lock:
        state = plan.load(day)
        pm = state.setdefault("paper_marks", {}).setdefault(sheet["subject"], {})
        for m in kept:
            lst = pm.setdefault(by_q[m["question_id"]]["topic_key"], [])
            lst[:] = [e for e in lst if not (e.get("sheet") == sid and e.get("q") == m["question_id"])]
            lst.append({"date": day, "got": m["got"], "max": m["max"], "q": m["question_id"], "origin": "sheet", "sheet": sid})
            del lst[:-40]
        plan.save(state)
        states = ((state.get("exam_prep") or {}).get(sheet["subject"]) or {}).get("topics") or {}
        keys = sorted({by_q[m["question_id"]]["topic_key"] for m in kept})
        prof = ww_generator.proficiency(states, pm, keys)
    return {k: prof.get(k) for k in keys}


def accept(store, plan, sid: str, qid: str, body: Any, at: str, day: str) -> dict:
    """R-84: {got?, minutes?, out_of?, keep?}. `got` left out takes the proposed number. The row goes through
    tonight.apply_marks, the check of R-58, and lands where R-58 lands it. Returns {sheet, mark, answer, proficiency,
    keep}; the caller writes `keep` to the question as R-58 does."""
    if not isinstance(body, dict) or set(body) - {"got", "minutes", "out_of", "keep"}:
        raise ValueError("Send {got?, minutes?, out_of?, keep?}.")
    # one hold of both locks from reading the proposal to writing mark_origin: a text change (which drops the
    # proposal) or a delete waits until the mark is recorded, so neither can land between the two (review, 28 Nov)
    with tonight._LOCK, _LOCK:
        sheet = tonight.load_sheet(store, sid)
        item_of(sheet, qid)
        rec = load(store, sid, qid)
        if rec is None:
            raise KeyError("No answer for this question on this sheet.")
        prop = rec.get("proposal") if isinstance(rec.get("proposal"), dict) else None
        proposed = None if prop is None else prop.get("got")
        if proposed is None and prop is not None and prop.get("basis") == "number" and "out_of" in body:
            o = body["out_of"]                           # marks not printed: the rule's match is all of his out_of, or 0
            if not isinstance(o, bool) and isinstance(o, (int, float)):
                proposed = _num(o) if prop.get("match") else 0
        if "got" in body:
            got = body["got"]
        elif proposed is not None:
            got = proposed
        else:
            raise ValueError("No mark is proposed for this answer: give got.")
        row = {"question_id": qid, "got": got, **{k: body[k] for k in ("minutes", "out_of", "keep") if k in body}}
        new, kept = tonight.apply_marks(sheet, [row], at)
        keep = tonight.keeps([row])
        prof = write_marks(plan, sheet, kept, day)
        tonight.save_sheet(store, new)
        mark = kept[0]
        same = proposed is not None and float(mark["got"]) == float(proposed)
        origin = "proposal" if same else "hand"
        rec["accepted"] = {"got": mark["got"], "max": mark["max"], "proposed_got": proposed,
                           "basis": None if prop is None else prop.get("basis"), "at": at}
        rec["mark_origin"] = origin
        _save(store, sid, rec)
    return {"sheet": new, "mark": mark, "answer": rec, "proficiency": prof, "keep": keep}
