"""A level on every question (wave EW13, L1; plan 9.0, the line of 28 Nov): the rule first, then the model for the rest.

    rule_level(text)                                        -> 1 to 5, or None when the rule is not certain
    level_subject(store, subject, apply, use_model, limit, model, stop, progress) -> dict   R-75 {rule, model, none, left, ...}

The five levels (the same words the prompt level_pick.md gives the model):
    1 recall      define, state, list, name
    2 concept     explain, why, compare, derive, prove
    3 numerical   a quantity asked for with given values
    4 combined    a numerical part and an explain, justify or design part in one question
    5 case        a described situation, system or product to analyse or design for

Who set a level is kept beside it: `level_source` "rule", "model" (with `level_model`, the model's name) or "hand" (R-07).
A hand's level is never touched here; a model's level never replaces a rule's; the rule may replace a model's (it is
the more certain of the two). The store refuses the same order on its side (Store._apply), so a race with his click
cannot write over him.

Why the rule is what it is: it must be certain or silent. A wrong level puts a question on the wrong rung of the ladder
and moves him up or down on marks that were not for that level; a missing level only waits for the model or for him.
So every doubt below goes to silence (the review of 28 Nov found seven certain and wrong labels; each is now a test):
  * Given values are a number with a unit ("4 kHz", "10 uF", "5 V") or a symbol with a value ("R = 10", "x(n) = {1, 2}").
    A bare count ("List 4 advantages") is not a given value: "list four" asks for recall, not a quantity. A trailing
    marks count ("5 m", "5 marks", "[5]", "(5M)") is taken off first: "... the network shown in the figure. 5 m" is a
    figure question with its marks printed after it, not a value of 5 metres.
  * Given values with no verb asking for a quantity are silent: "What is the Nyquist rate of a 4 kHz signal?" reads as
    recall by its verb and is a numerical; "Define the 3 dB bandwidth" carries a value and is a definition.
  * A verb asking for a quantity with no given value is silent ("Find the Thevenin equivalent of the network shown":
    the values are in a figure), and so is one whose object is "whether" or "if" ("Determine whether the system ... is
    linear", "Find whether ... is stable"): that asks for a property, not a quantity.
  * A recall or concept sentence beside a sentence asking for a quantity is silent ("What is meant by resonance?
    Calculate ...", "Define gain margin. Determine it for ..."): two kinds in one question are the model's to weigh.
    So is a question that names a numerical example without asking for a quantity ("Explain ... with a numerical
    example"). Lettered parts ((a), (b), (i), "a)") or an OR between alternatives are each read with the stem; when
    they are not all the same level the question is silent.
  * Level 5 needs an explicit case marker: "case study", "case:", "scenario", "a company / firm / startup ... that",
    "you are", "suppose you", "imagine you", "as a consultant", "design a ... for a". A noun alone ("a bank", "a
    firm has a cost function") is no case. With a marker it also needs a verb asking him to act on the situation
    (analyse, design, suggest, recommend, propose, identify, plan, advise, develop) and no verb asking for a quantity
    ("A firm ... Calculate the break-even quantity and evaluate the profit at Q = 40" is a numerical, and with a marker
    it is silent), and at least CASE_MIN (150) characters: the six invented case questions of the tests run 192 to 223
    characters. A question with a marker that fails any of these is silent. Measured on invented text only.
  * No asking verb at all: silent.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Optional

from .prep import HELD_ROLES, MAX_LIMIT, MAX_QUESTION_CHARS, MODEL_BATCH, Model, _one_line, _plural, ask, role_of
from .store import Store

LEVELS = (1, 2, 3, 4, 5)
NAMES = {1: "recall", 2: "concept", 3: "numerical", 4: "combined", 5: "case or application"}
SOURCES = ("none", "model", "rule", "hand")          # in the order of trust: a later one is never replaced by an earlier
CASE_MIN = 150

# ------------------------------------------------------------------ the verb lists, as data
# Recall: the answer is a fact he has or has not. "state" is matched as a whole word, so "statement" never counts.
RECALL = ("define", "state", "list", "name", "enumerate", "mention", "what is meant by", "write the full form",
          "expand the abbreviation")
# Concept: the answer is reasoning. "differentiate between" only: a bare "differentiate" in mathematics asks for a
# derivative (a numerical), so it is in neither list and the rule stays silent on it. "show that" is a proof.
CONCEPT = ("explain", "why", "compare", "derive", "prove", "describe", "discuss", "distinguish", "differentiate between",
           "illustrate", "elaborate", "interpret", "show that", "justify", "how does", "how do", "give reasons")
# Asking for a quantity. "estimate" asks for a number as "evaluate" does; "obtain" is left out ("obtain the expression"
# asks for a derivation as often as for a value).
QUANTITY = ("calculate", "find", "determine", "compute", "evaluate", "estimate", "solve for")
# The second part of a combined question (level 4): a reason or a design beside the number.
REASON = ("explain", "justify", "comment", "design", "why", "discuss", "compare", "derive", "prove", "interpret",
          "give reasons", "what do you infer")
# What a case asks him to do with the situation. "evaluate" is not here: "evaluate the profit at Q = 40" asks for a
# quantity (the review's firm question), so it stays a quantity verb only.
CASE_ASK = ("analyse", "analyze", "design", "suggest", "recommend", "propose", "identify", "plan", "advise",
            "what would you", "how would you", "develop", "prepare")
_ORG = r"(?:company|firm|startup|start-up|organi[sz]ation|hospital|bank|factory|manufacturer|retailer|client|school)"
_CASE_MARK = re.compile(r"\bcase study\b|\bcase\s*:|\bscenario\b|\byou are\b|\bsuppose you\b|\bimagine you\b|"
                        r"\bas a consultant\b|\byou have been asked\b|"
                        r"\b(?:a|an)\s+(?:[a-z-]+\s+){0,2}" + _ORG + r"\s+(?:that|which|who|whose)\b|"
                        r"\bdesign (?:a|an)\b[^.]{1,80}?\bfor (?:a|an)\b")

_UNITS = (r"(?:[kMGT]?Hz|[mukM]?V|[munµ]?A|[kM]?(?:Ω|ohms?)|[kmM]?W|[munµp]?F|[muµ]?H|[munµ]?s|"
          r"[cmk]?m|kg|g|N|J|Pa|dB|dBm|%|rad(?:/s)?|m/s|[kM]?bps|°C|K|samples(?:/s)?|bits|bytes)")
_VALUE_UNIT = re.compile(r"(?<![A-Za-z0-9_])[-+]?\d+(?:\.\d+)?(?:\s*[x×]\s*10\^?-?\d+)?\s*" + _UNITS + r"(?![A-Za-z])")
_SYMBOL_VALUE = re.compile(r"(?<![A-Za-z0-9_])(?:[A-Za-z]{1,2}(?:_?[A-Za-z0-9]{1,3})?|[A-Za-z]\([a-z]\))\s*=\s*"
                           r"(?:[-+]?\d|\{\s*[-+]?\d)")
# a label, marks, a course outcome or a Bloom level printed inside the text is not a value of the question
_NOISE = re.compile(r"^\s*(?:Q\.?\s*)?\d+[a-z]?\s*[.):]\s*|[\(\[]\s*\d+(?:\.\d+)?\s*(?:marks?|m)\s*[\)\]]|"
                    r"\b(?:CO|BL|L|K)\s*\d\b", re.I)
# the marks printed after the last word: "5 m", "5 marks", "5M", "[5]", "(5)"
_TRAILING_MARKS = re.compile(r"\s*(?:\[\s*\d+(?:\.\d+)?\s*\]|\(\s*\d+(?:\.\d+)?\s*(?:marks?|m)?\s*\)|"
                             r"\d+(?:\.\d+)?\s*(?:marks?|m)\.?)\s*$", re.I)
_PART = re.compile(r"(?:^|(?<=\s))\(?(?:[a-h]|i{1,3}|iv|vi{0,3}|ix|x)\)\s+|\bOR\b")
_OR = re.compile(r"\bOR\b")                           # upper case only: "or" inside a sentence is not a choice
_SENTENCE = re.compile(r"(?<=[.?!])\s+(?=[A-Z(])")
_WHETHER = re.compile(r"\b(?:calculate|find|determine|compute|evaluate|estimate|check)\s+(?:out\s+)?(?:whether|if)\b")
_NUMERICAL = re.compile(r"\bnumerical")

# a single verb counts only where an order begins: at the start, after a stop, a comma or a part's bracket, or after
# "and", "hence" and the like. "Draw the state diagram" is not "State ...", and "the design of" is not "Design ...".
_LEAD = r"(?:^|[.;:?!,()]\s*|\b(?:and|also|then|hence|briefly|clearly|neatly|first|next|now|further|thus|so)\s+)"


def _has(text: str, words: tuple, lead: bool = True) -> bool:
    """True when one of `words` is in the text. A phrase (two words or more, or "why") may stand anywhere; a single
    verb only where an order begins, unless `lead` is false."""
    low = text.lower()
    for w in words:
        tail = r"(?![a-z])" if w[-1].isalpha() else ""
        if " " in w or w == "why" or not lead or not w.isalpha():
            pat = r"(?<![a-z])" + re.escape(w) + tail
        else:
            pat = _LEAD + re.escape(w) + tail
        if re.search(pat, low):
            return True
    return False


def has_values(text: str) -> bool:
    """A number with a unit or a symbol with a value, after the label, the marks and outcome codes are taken out."""
    t = _NOISE.sub(" ", _TRAILING_MARKS.sub("", text))
    return bool(_VALUE_UNIT.search(t) or _SYMBOL_VALUE.search(t))


def _single(text: str) -> Optional[int]:
    """The level of one part (or a question of one part), levels 1 to 4; None when not certain."""
    vals, qty = has_values(text), _has(text, QUANTITY)
    if qty and vals:
        return 4 if _has(text, REASON) else 3
    if qty or vals:
        return None                  # a quantity with its values in a figure, or values with no quantity asked
    if _has(text, CONCEPT):
        return 2                     # "state and prove" asks for the proof: the concept is the harder of the two
    if _has(text, RECALL):
        return 1
    return None


def _parts(text: str) -> list[str]:
    """The pieces to read one by one: OR alternatives each alone (the stem is the first alternative), lettered parts
    each after the stem ("<stem>. <part>", so a part's verb still begins an order); [text] for fewer than two."""
    pieces = [p.strip() for p in _PART.split(text)]
    if _OR.search(text):
        alts = [p for p in pieces if p]
        return alts if len(alts) >= 2 else [text]
    stem, rest = pieces[0], [p for p in pieces[1:] if p]
    if len(rest) < 2:
        return [text]
    return [f"{stem}. {p}" if stem else p for p in rest]


def _mixed_sentences(text: str) -> bool:
    """True when one sentence asks for a quantity and another asks for recall or reasoning."""
    kinds = set()
    for s in _SENTENCE.split(text):
        if _has(s, QUANTITY):
            kinds.add("quantity")
        elif _has(s, RECALL) or _has(s, CONCEPT):
            kinds.add("words")
    return len(kinds) == 2


def rule_level(text: Any) -> Optional[int]:
    """The rule's level, or None. Certain or silent: see the module docstring for each edge."""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    t = _TRAILING_MARKS.sub("", t).strip()
    if not t:
        return None
    low = t.lower()
    if _CASE_MARK.search(low):
        ok = len(t) >= CASE_MIN and _has(t, CASE_ASK, lead=False) and not _has(t, QUANTITY)
        return 5 if ok else None
    if _WHETHER.search(low) or _mixed_sentences(t) or (_NUMERICAL.search(low) and not _has(t, QUANTITY)):
        return None
    parts = _parts(t)
    if len(parts) == 1:
        return _single(t)
    found = {_single(p) for p in parts}
    return found.pop() if len(found) == 1 and None not in found else None


# ------------------------------------------------------------------ R-75
def _try(store: Store, ids: list[str], changes: dict) -> set[str]:
    """The ids written. Store.update_questions is all or none, so a refused batch is halved and each half tried again:
    only the refused ids end in a call of their own (a refusal is a race with his click, so it is rare), never a loop
    over every id."""
    if not ids:
        return set()
    try:
        store.update_questions(ids, changes, "rule")
        return set(ids)
    except (ValueError, KeyError):
        if len(ids) == 1:
            return set()
    mid = len(ids) // 2
    return _try(store, ids[:mid], changes) | _try(store, ids[mid:], changes)


def _write(store: Store, picks: dict[str, int], source: str, model_name: str = "") -> set[str]:
    """The ids written, one store write a level when nothing is refused. The store refuses a level over one of more
    trust (his click, or the rule's, landing while the model thought). No re-read of the store here: on his store
    (89 papers, 889 questions) reading it again for each batch or question is what stopped the app answering (28 Nov)."""
    by_level: dict[int, list[str]] = {}
    for qid, n in picks.items():
        by_level.setdefault(n, []).append(qid)
    done: set[str] = set()
    for n, ids in sorted(by_level.items()):
        done |= _try(store, ids, {"level": n, "level_source": source, "level_model": model_name})
    return done


def _open(store: Store, sid: str) -> tuple[list[dict], dict]:
    papers = {p["id"]: p for p in store.list_papers(sid)}
    rows = [q for q in store.list_questions(subject=sid) if q.get("status") != "rejected"]
    held = sum(1 for q in rows if role_of(papers.get(q["paper_id"])) in HELD_ROLES)
    rows = [q for q in rows if role_of(papers.get(q["paper_id"])) not in HELD_ROLES and q.get("not_question") is not True]
    return rows, {"solution_items": held}


def _length(text: Any) -> int:
    return len(re.sub(r"\s+", " ", str(text or "")).strip())


def level_subject(store: Store, subject: dict, *, apply: bool, use_model: bool, limit: Optional[int], model: Model,
                  stop: Optional[Callable[[], bool]] = None, progress: Optional[Callable[[int], None]] = None) -> dict:
    """R-75, the way R-68 does tags. Solutions, notes and items judged not a question are left out; a level set by hand
    is never touched (held_by_hand). Then the rule on every other question; then the model, in batches of MODEL_BATCH
    and at most `limit` a call (None: all, for the job), for the questions still without a level. The subject's
    questions are read once a call. With apply false the model is never called: `would_ask` says how many it would
    be sent. A question over MAX_QUESTION_CHARS is never sent (the model would see it cut): it stays without a level
    and counts in `too_long`. Counts: rule and model are what this call wrote (or would write), none what the model
    was asked and gave no usable level for, left what was not asked or was in a failed batch."""
    if not isinstance(apply, bool) or not isinstance(use_model, bool):
        raise ValueError("Apply and use_model are true or false.")
    if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_LIMIT):
        raise ValueError(f"The limit is between 1 and {MAX_LIMIT}.")
    sid = str(subject["id"]).lower()
    rows, extra = _open(store, sid)
    out = {"rule": 0, "model": 0, "none": 0, "left": 0, "dropped": 0, "failed_batches": 0, "asked": 0, "would_ask": 0,
           "too_long": 0, "model_name": "", "held_by_hand": sum(1 for q in rows if q.get("level_source") == "hand"),
           "no_text": 0, "stopped": False, "by_level": {str(n): 0 for n in LEVELS}, **extra}
    mine = [q for q in rows if q.get("level_source") != "hand"]
    out["no_text"] = sum(1 for q in mine if not str(q.get("text") or "").strip())
    mine = [q for q in mine if str(q.get("text") or "").strip()]
    remaining: list[dict] = []
    rule_picks: dict[str, int] = {}
    for q in mine:
        n = rule_level(q.get("text"))
        if n is None:
            if q.get("level") is not None:
                continue                            # a model's level already on file is settled until the rule speaks
            if _length(q.get("text")) > MAX_QUESTION_CHARS:
                out["too_long"] += 1
            else:
                remaining.append(q)
            continue
        if q.get("level_source") == "rule" and q.get("level") == n:
            continue                                # already so: a second call writes nothing
        rule_picks[q["id"]] = n
    written = _write(store, rule_picks, "rule") if apply and rule_picks else set(rule_picks)
    for qid in written:
        out["rule"] += 1
        out["by_level"][str(rule_picks[qid])] += 1
    answered: set[str] = set()
    model_on = use_model and model.mode != "off" and bool(remaining)
    send = remaining if limit is None else remaining[:limit]
    if model_on and not apply:
        out["would_ask"] = len(send)              # a look: nothing leaves this PC
    elif model_on:
        out["model_name"] = model.name
        for i in range(0, len(send), MODEL_BATCH):
            if stop is not None and stop():
                out["stopped"] = True
                break
            batch = send[i:i + MODEL_BATCH]
            qmap = {f"Q{j + 1}": q for j, q in enumerate(batch)}
            fields = {"subject": str(subject.get("name") or sid),
                      "questions": "\n".join(f"{k}: {_one_line(q['text'])}" for k, q in qmap.items()),
                      "question_ids": ",".join(qmap)}
            out["asked"] += len(batch)
            ans = ask("level_pick", fields, model)
            if ans is None:
                out["failed_batches"] += 1             # its questions stay as they were and count as left
                if progress is not None:
                    progress(len(batch))
                continue
            out["dropped"] += int(ans.get("dropped") or 0)
            picks = {p["id"]: p["level"] for p in ans["picks"]}
            got: dict[str, int] = {}
            for k, q in qmap.items():
                answered.add(q["id"])
                n = picks.get(k)
                if n is None:
                    out["none"] += 1                    # not answered, or answered outside 1 to 5: stays null
                    continue
                got[q["id"]] = n
            # he (or the rule) may have set one while the model was thinking: the store refuses the model over it
            for qid in _write(store, got, "model", model.name) if got else set():
                out["model"] += 1
                out["by_level"][str(got[qid])] += 1
            if progress is not None:
                progress(len(batch))
    out["left"] = sum(1 for q in remaining if q["id"] not in answered)
    did = "Set" if apply else "Would set"
    reason = (f"{did} a level on {out['rule']} by rule and {out['model']} by the model; the model gave none for "
              f"{out['none']}, {out['left']} {'is' if out['left'] == 1 else 'are'} still without a level.")
    if out["would_ask"]:
        reason += f" With apply, {_plural(out['would_ask'], 'question', 'questions')} would go to the model."
    if out["too_long"]:
        reason += (f" {_plural(out['too_long'], 'question is', 'questions are')} over {MAX_QUESTION_CHARS} characters, "
                   f"too long to send whole, and {'keeps' if out['too_long'] == 1 else 'keep'} no level until you set one.")
    if out["held_by_hand"]:
        reason += f" {_plural(out['held_by_hand'], 'level you set is', 'levels you set are')} kept as {'it is' if out['held_by_hand'] == 1 else 'they are'}."
    if out["solution_items"]:
        reason += f" {_plural(out['solution_items'], 'item', 'items')} of solution sheets or notes {'was' if out['solution_items'] == 1 else 'were'} left out."
    if out["failed_batches"]:
        reason += f" {_plural(out['failed_batches'], 'batch', 'batches')} of the model failed and changed nothing."
    if out["stopped"]:
        reason += " Stopped after the batch in hand."
    if not rows:
        return {**out, "state": "waiting", "reason": "No question of this subject on file yet."}
    return {**out, "state": "live", "reason": reason}
