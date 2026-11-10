"""Knowledge of the day, six slots, never generated.

    tracks   exam | skill | life     one concept each, drawn from the concept bank
    lists    word | fact | thought   one line each, from his curated lists

Nothing here writes text. A track item is a topic of an exam paper (exam), an outcome of a
skill-tree node (skill) or a concept of the learning bank (life); a list item is a line he put in
words.txt / facts.txt / thoughts.txt. An empty pool is an answer in words, never a filler.

Lists: one item per line in <knowledge folder>/{words,facts,thoughts}.txt (or .md).
A word is "word :: meaning" (" - " and an em dash work too). Blank lines and lines starting with
"#" are skipped. The folder is JARVIS_KNOWLEDGE_DIR, else "knowledge/" beside the engine inputs
(data/notes/well-wisher/knowledge): private, read at runtime on every draw, so a line he adds
shows up on the next refresh without a restart.

Draws: the first read of a day draws all six; "refresh" draws a new one for one slot. A draw
never repeats an item seen in the last W draws of that slot, W = min(30, pool size - 1). The
window is a fraction of the pool while it is small (a 5-item pool repeats after 4, not never)
and caps at 30 so a big bank still comes back to old items; as the bank grows the window grows
with it, up to the cap. Among the candidates an item never seen before wins; once all were seen
the one seen longest ago wins; ties break by a seeded choice (date, slot, draw number), so a
test, and a bug report, can replay it. A pool of one repeats, and the answer says so.

State: "@ww_knowledge" in the key-value store: {"seen": {slot: [{"id","date"}]},
"today": {"date", "slots": {slot: item}}}. The drawn item is stored whole, so a read costs no
pool rebuild and a line he edits later does not change today's card.
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import threading
from pathlib import Path
from typing import Any, Callable, Optional

KEY = "@ww_knowledge"
TRACKS = ("exam", "skill", "life")
LISTS = ("word", "fact", "thought")
SLOTS = TRACKS + LISTS
FILES = {"word": "words", "fact": "facts", "thought": "thoughts"}
LABEL = {"exam": "Exam subject", "skill": "Skill tree", "life": "Life", "word": "Word", "fact": "Fact", "thought": "Thought"}
WINDOW = 30                  # a month of one-a-day draws: long enough to forget, short enough that a 40-item pool still cycles
KEEP_SEEN = 400              # draws remembered per slot; 400 > any window that can be asked for
MAX_LINE = 600
_lock = threading.RLock()
_SPLIT = re.compile(r"\s(?:::|—|-)\s")


# ------------------------------------------------------------------ the curated lists
def knowledge_dir() -> Path:
    env = os.environ.get("JARVIS_KNOWLEDGE_DIR")
    if env:
        return Path(env)
    from . import ww_engines
    return ww_engines.inputs_path().parent / "knowledge"


def _item_id(slot: str, text: str) -> str:
    # Hash of the words, not the line number: reordering the file or adding lines elsewhere keeps every id.
    return slot[0] + hashlib.sha1(" ".join(text.lower().split()).encode("utf-8")).hexdigest()[:10]


def parse_list(slot: str, text: str) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for line in text.splitlines():
        line = line.strip().lstrip("﻿")
        line = re.sub(r"^(?:[-*•]|\d+[.)])\s+", "", line)
        if not line or line.startswith("#"):
            continue
        line = line[:MAX_LINE]
        title, body = "", line
        if slot == "word":
            parts = _SPLIT.split(line, maxsplit=1)
            if len(parts) == 2:
                title, body = parts[0].strip(), parts[1].strip()
            else:
                title, body = line, ""
        iid = _item_id(slot, line)
        if iid in seen:                      # a line typed twice is one item
            continue
        seen.add(iid)
        out.append({"id": iid, "title": title, "body": body, "source": "list"})
    return out


def load_list(slot: str, directory: Optional[Path] = None) -> list[dict]:
    d = directory or knowledge_dir()
    for ext in (".txt", ".md"):
        try:
            return parse_list(slot, (d / f"{FILES[slot]}{ext}").read_text(encoding="utf-8-sig"))
        except OSError:
            continue
    return []


def empty_say(slot: str) -> str:
    if slot in LISTS:
        return f"No {FILES[slot]} yet: add lines to {FILES[slot]}.txt in the knowledge folder and refresh."
    return {"exam": "No exam topics to draw from yet.",
            "skill": "The skill tree has no outcomes to draw from yet.",
            "life": "The learning bank has no concepts yet."}[slot]


# ------------------------------------------------------------------ the track pools (the concept bank)
def exam_pool(plan, today: str) -> list[dict]:
    """Topics of the exam papers the exams engine plans for, as concepts."""
    ex = plan.engine("exams", today)
    out: list[dict] = []
    for p in ex.get("papers") or []:
        for t in p.get("topics") or []:
            out.append({"id": f"{p['id']}:{t['key']}", "title": str(t.get("topic") or t["key"]),
                        "body": " | ".join(x for x in (str(t.get("unit_title") or ""), str(p.get("title") or p.get("subject") or "")) if x),
                        "source": "exams", "ref": p["id"]})
    return out


def skill_pool(bank: dict) -> list[dict]:
    """One concept per outcome of each skill-tree node (the node itself when it states none)."""
    out: list[dict] = []
    for nid in bank.get("order") or list((bank.get("nodes") or {})):
        n = bank["nodes"][nid]
        outs = n.get("outcomes") or []
        if outs:
            out += [{"id": f"{nid}#{i}", "title": n["name"], "body": o, "source": "skilltree", "ref": nid} for i, o in enumerate(outs)]
        else:
            out.append({"id": f"{nid}#0", "title": n["name"], "body": "", "source": "skilltree", "ref": nid})
    return out


def life_pool() -> tuple[list[dict], str]:
    """The learning bank's concepts (LEARN.md, or the fictional example, said in `source`)."""
    from . import learn_bank
    b = learn_bank.load()
    return ([{"id": c["id"], "title": c["title"], "body": c.get("body") or "", "source": "learn-" + b["source"]} for c in b["concepts"]],
            b["source"])


# ------------------------------------------------------------------ drawing
def window_for(pool_size: int) -> int:
    return min(WINDOW, max(0, pool_size - 1))


def draw(pool: list[dict], seen: list[dict], seed: str) -> tuple[Optional[dict], dict]:
    """One item from the pool, and how it was chosen. `seen` is the slot's history, oldest first."""
    if not pool:
        return None, {"pool": 0, "window": 0}
    w = window_for(len(pool))
    recent: list[str] = []
    for s in reversed(seen) if w else ():
        if s["id"] not in recent:
            recent.append(s["id"])
        if len(recent) >= w:
            break
    cand = [p for p in pool if p["id"] not in recent]
    last = {s["id"]: i for i, s in enumerate(seen)}           # later wins: the latest position
    fresh = [p for p in cand if p["id"] not in last]
    if fresh:
        cand = fresh
    else:
        oldest = min(last[p["id"]] for p in cand)
        cand = [p for p in cand if last[p["id"]] == oldest]
    pick = random.Random(seed).choice(sorted(cand, key=lambda p: p["id"]))
    return pick, {"pool": len(pool), "window": w, "fresh": bool(fresh)}


def _load(kv) -> dict:
    try:
        v = json.loads(kv.get(KEY) or "{}")
    except ValueError:
        v = {}
    if not isinstance(v, dict):
        v = {}
    v.setdefault("seen", {})
    if not isinstance(v.get("today"), dict):
        v["today"] = {"date": None, "slots": {}}
    return v


def _pool(slot: str, plan, bank: dict, today: str) -> list[dict]:
    if slot in LISTS:
        return load_list(slot)
    if slot == "exam":
        return exam_pool(plan, today) if plan is not None else []
    if slot == "skill":
        return skill_pool(bank)
    return life_pool()[0]


def _draw_slot(st: dict, slot: str, today: str, plan, bank: dict) -> dict:
    pool = _pool(slot, plan, bank, today)
    seen = st["seen"].setdefault(slot, [])
    n = sum(1 for s in seen if s.get("date") == today)
    item, info = draw(pool, seen, f"{today}|{slot}|{n}")
    if item is None:
        return {"slot": slot, "label": LABEL[slot], "empty": True, "say": empty_say(slot)}
    seen.append({"id": item["id"], "date": today})
    del seen[:-KEEP_SEEN]
    note = ("Only one item in this bank, so it repeats." if info["pool"] == 1 else
            "" if info["fresh"] else "Every item has been shown; this is the one seen longest ago.")
    return {"slot": slot, "label": LABEL[slot], "empty": False, "id": item["id"], "title": item["title"], "body": item["body"],
            "source": item["source"], "ref": item.get("ref"), "pool": info["pool"], "window": info["window"], "drawn": n + 1,
            "note": note}


def today_view(kv, today: str, plan=None, bank: Optional[dict] = None) -> dict:
    """The six slots for today. The first read of a day draws; later reads return the same cards.
    A slot that came up empty is tried again on each read, so a list he fills mid-day appears."""
    bank = bank or {"nodes": {}, "order": []}
    with _lock:
        st = _load(kv)
        if st["today"].get("date") != today:
            st["today"] = {"date": today, "slots": {}}
        slots = st["today"]["slots"]
        changed = False
        for s in SLOTS:
            if s not in slots or slots[s].get("empty"):
                new = _draw_slot(st, s, today, plan, bank)
                if s not in slots or not new.get("empty"):
                    slots[s] = new
                    changed = True
        if changed:
            kv.set(KEY, json.dumps(st))
    return _out(today, slots)


def refresh(kv, slot: str, today: str, plan=None, bank: Optional[dict] = None) -> dict:
    """A new item for one slot. Raises ValueError for an unknown slot."""
    if slot not in SLOTS:
        raise ValueError(f"slot is one of {', '.join(SLOTS)}")
    bank = bank or {"nodes": {}, "order": []}
    with _lock:
        st = _load(kv)
        if st["today"].get("date") != today:
            st["today"] = {"date": today, "slots": {}}
        st["today"]["slots"][slot] = _draw_slot(st, slot, today, plan, bank)
        kv.set(KEY, json.dumps(st))
        slots = st["today"]["slots"]
    return _out(today, slots)


def _out(today: str, slots: dict) -> dict:
    order = [slots[s] for s in SLOTS if s in slots]
    return {"date": today, "tracks": [x for x in order if x["slot"] in TRACKS], "lists": [x for x in order if x["slot"] in LISTS],
            "empty": all(x.get("empty") for x in order)}
