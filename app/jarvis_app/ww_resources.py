"""Resource progress: the checklist of a resource, where he is in it, sections done per week.

A resource (germoney bank: a course, a book, a lecture series) is one line in the skill tree.
That is too coarse to say "I am at lecture 7 of 24". So he types a checklist once per resource
(chapters, lectures, exercise sets); taps then record state and position:

    done   the section is finished (counts in the week it was tapped)
    skip   he chose not to do it; it leaves the denominator, so skipping never lowers progress
    open   clear a mark (an undo is a tap, not a rewrite)
    here   "I am here": moves the bookmark without finishing anything

Everything shown is counted from those taps: no section is ever marked done on its own, no
percentage is invented, and a resource without a checklist says so in words.

Storage: one key-value key, "@ww_resources", beside the plan state (not inside it:
germoney.merge_plan_state drops keys it does not list, see routes_ww_dmat.py). The shape is

    {"lists": {rid: {"items": [{"id","title","kind"}], "done": {item_id: "YYYY-MM-DD"},
                     "skip": [item_id], "at": item_id | null, "typed": "YYYY-MM-DD"}}}

Re-typing a checklist keeps every mark whose item id survives (the id is the slug of the title),
so fixing a typo in lecture 12 does not lose the 11 lectures already ticked.

Pure functions over `kv` (anything with get/set of str) and a bank dict; no I/O besides the kv.
"""
from __future__ import annotations

import json
import re
import threading
from datetime import date, timedelta
from typing import Any, Optional

KEY = "@ww_resources"
MAX_ITEMS = 300             # a 24-lecture course is 24; a 900-page book by chapter is ~40; 300 stops a pasted TOC of a library
MAX_TITLE = 120
STATES = ("done", "skip", "open", "here")
KINDS = ("chapter", "lecture", "exercise", "week", "section")
WEEKS_DEFAULT = 8           # two months of weekly counts: enough to see a trend, small enough for a phone card
WEEKS_MAX = 52
_lock = threading.RLock()
_SLUG = re.compile(r"[^a-z0-9]+")
_KIND_WORDS = {"exercise": "exercise", "exercises": "exercise", "problem": "exercise", "problems": "exercise", "set": "exercise",
               "assignment": "exercise", "chapter": "chapter", "ch": "chapter", "lecture": "lecture", "lec": "lecture",
               "video": "lecture", "week": "week", "module": "week"}


# ------------------------------------------------------------------ checklist parsing
def _slug(title: str) -> str:
    return _SLUG.sub("-", title.lower()).strip("-")[:60] or "item"


def _kind_of(title: str) -> str:
    # The first whole word decides: "Setup notes" is a section, "Set 3" is an exercise set.
    return _KIND_WORDS.get(re.split(r"[\s:.\-]", title.lower(), maxsplit=1)[0], "section")


def parse_checklist(raw: Any) -> list[dict]:
    """Items from a pasted text (one line each) or a list of strings / {title, kind} dicts.
    Blank lines and a leading bullet or number ("- ", "3. ") are dropped. Ids are slugs of the
    title, a repeated title gets -2, -3. Raises ValueError in plain words."""
    if isinstance(raw, str):
        rows: list[Any] = raw.splitlines()
    elif isinstance(raw, list):
        rows = raw
    else:
        raise ValueError("send the checklist as text (one item per line) or a list")
    out: list[dict] = []
    seen: dict[str, int] = {}
    for r in rows:
        kind = None
        if isinstance(r, dict):
            title, kind = r.get("title"), r.get("kind")
        else:
            title = r
        if not isinstance(title, str):
            raise ValueError("every checklist item needs a title")
        title = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", title).strip()
        if not title:
            continue
        if len(title) > MAX_TITLE:
            raise ValueError(f"an item is longer than {MAX_TITLE} characters: {title[:30]}...")
        if kind is not None and kind not in KINDS:
            raise ValueError(f"kind is one of {', '.join(KINDS)}")
        base = _slug(title)
        n = seen.get(base, 0) + 1
        seen[base] = n
        out.append({"id": base if n == 1 else f"{base}-{n}", "title": title, "kind": kind or _kind_of(title)})
        if len(out) > MAX_ITEMS:
            raise ValueError(f"at most {MAX_ITEMS} items in one checklist")
    if not out:
        raise ValueError("the checklist is empty: type at least one item")
    return out


# ------------------------------------------------------------------ storage
def _load(kv) -> dict:
    try:
        v = json.loads(kv.get(KEY) or "{}")
    except ValueError:
        v = {}
    if not isinstance(v, dict) or not isinstance(v.get("lists"), dict):
        return {"lists": {}}
    return v


def _save(kv, st: dict) -> None:
    kv.set(KEY, json.dumps(st))


def _check_rid(bank: dict, rid: str) -> dict:
    r = (bank.get("resources") or {}).get(rid)
    if r is None:
        raise ValueError(f"unknown resource: {rid}")
    return r


def set_checklist(kv, bank: dict, rid: str, raw: Any, today: str) -> dict:
    """Type (or re-type) the checklist. Marks survive for items whose id is still there; the
    answer says how many marks were kept and how many were dropped because their item went."""
    _check_rid(bank, rid)
    items = parse_checklist(raw)
    ids = {i["id"] for i in items}
    with _lock:
        st = _load(kv)
        old = st["lists"].get(rid) or {}
        done = {k: v for k, v in (old.get("done") or {}).items() if k in ids}
        skip = [k for k in (old.get("skip") or []) if k in ids]
        dropped = len(old.get("done") or {}) - len(done) + len(old.get("skip") or []) - len(skip)
        at = old.get("at") if old.get("at") in ids else None
        st["lists"][rid] = {"items": items, "done": done, "skip": skip, "at": at, "typed": today}
        _save(kv, st)
    return {"rid": rid, "items": len(items), "kept_marks": len(done) + len(skip), "dropped_marks": dropped}


def clear_checklist(kv, bank: dict, rid: str) -> dict:
    _check_rid(bank, rid)
    with _lock:
        st = _load(kv)
        had = st["lists"].pop(rid, None) is not None
        _save(kv, st)
    return {"rid": rid, "removed": had}


def tap(kv, bank: dict, rid: str, item: str, state: str, today: str) -> dict:
    """Record one tap. done/skip/here also move the bookmark to this item (where he is);
    open clears the mark and leaves the bookmark. Returns the resource's summary."""
    _check_rid(bank, rid)
    if state not in STATES:
        raise ValueError(f"state is one of {', '.join(STATES)}")
    with _lock:
        st = _load(kv)
        rec = st["lists"].get(rid)
        if not rec:
            raise ValueError("this resource has no checklist yet: type one first")
        if item not in {i["id"] for i in rec["items"]}:
            raise ValueError(f"unknown item: {item}")
        was_done = rec["done"].pop(item, None)
        if item in rec["skip"]:
            rec["skip"].remove(item)
        if state == "done":
            # A second done tap keeps the first date: a repeat must not slide the section into a later week.
            rec["done"][item] = was_done or today
        elif state == "skip":
            rec["skip"].append(item)
        if state != "open":
            rec["at"] = item
        _save(kv, st)
    return summary(bank, rid, st["lists"][rid], today)


# ------------------------------------------------------------------ reading
def week_start(day: str) -> str:
    d = date.fromisoformat(day)
    return (d - timedelta(days=d.weekday())).isoformat()


def _state_of(rec: dict, item_id: str) -> str:
    if item_id in rec["done"]:
        return "done"
    return "skip" if item_id in rec["skip"] else "open"


def summary(bank: dict, rid: str, rec: Optional[dict], today: str) -> dict:
    r = (bank.get("resources") or {}).get(rid) or {}
    base = {"rid": rid, "title": r.get("title") or rid, "kind": r.get("kind"), "url": r.get("url"),
            "nodes": [n["id"] for n in (bank.get("nodes") or {}).values() if rid in n.get("resources", [])]}
    if not rec or not rec.get("items"):
        return {**base, "has_list": False, "total": 0, "done": 0, "skipped": 0, "left": 0, "pct": None, "at": None, "next": None,
                "say": "No checklist yet: type its chapters or lectures once and the taps will count from there."}
    items = rec["items"]
    total = len(items)
    done = sum(1 for i in items if i["id"] in rec["done"])
    skipped = sum(1 for i in items if i["id"] in rec["skip"])
    counted = total - skipped
    left = counted - done
    order = [i["id"] for i in items]
    at = rec.get("at")
    # "next" is the first open section after the bookmark, else the first open one overall:
    # he may skip around, and the bookmark is where he last was, not a promise of order.
    after = order[order.index(at) + 1:] if at in order else order
    nxt = next((i for i in after if _state_of(rec, i) == "open"), None) or next((i for i in order if _state_of(rec, i) == "open"), None)
    by_id = {i["id"]: i for i in items}
    wk = week_start(today)
    this_week = sum(1 for d in rec["done"].values() if week_start(d) == wk)
    if left <= 0:
        say = f"All {done} sections done" + (f", {skipped} skipped." if skipped else ".")
    else:
        say = f"{done} of {counted} sections done" + (f" ({skipped} skipped)" if skipped else "") + f"; {left} left."
    return {**base, "has_list": True, "total": total, "done": done, "skipped": skipped, "left": left,
            "pct": round(100 * done / counted) if counted > 0 else None,
            "at": {"id": at, "title": by_id[at]["title"]} if at in by_id else None,
            "next": {"id": nxt, "title": by_id[nxt]["title"]} if nxt else None,
            "this_week": this_week, "typed": rec.get("typed"), "say": say}


def detail(kv, bank: dict, rid: str, today: str) -> dict:
    _check_rid(bank, rid)
    rec = _load(kv)["lists"].get(rid)
    out = summary(bank, rid, rec, today)
    if rec:
        at = rec.get("at")
        out["items"] = [{"id": i["id"], "title": i["title"], "kind": i["kind"], "state": _state_of(rec, i["id"]),
                         "date": rec["done"].get(i["id"]), "here": i["id"] == at} for i in rec["items"]]
    else:
        out["items"] = []
    return out


def weekly(kv, bank: dict, today: str, weeks: int = WEEKS_DEFAULT) -> dict:
    """Sections done per week, oldest first, the current week last (it is partial: `partial`
    says so, so a half-finished week is never read as a slump). Counted from the done dates, so
    undoing a tap lowers the week it was in."""
    weeks = max(1, min(int(weeks), WEEKS_MAX))
    st = _load(kv)
    this = date.fromisoformat(week_start(today))
    starts = [(this - timedelta(weeks=k)).isoformat() for k in range(weeks - 1, -1, -1)]
    series = {s: {"week": s, "done": 0, "by_resource": {}} for s in starts}
    known = bank.get("resources") or {}
    for rid, rec in st["lists"].items():
        if rid not in known:
            continue
        for d in (rec.get("done") or {}).values():
            try:
                w = week_start(d)
            except ValueError:
                continue
            if w in series:
                series[w]["done"] += 1
                series[w]["by_resource"][rid] = series[w]["by_resource"].get(rid, 0) + 1
    rows = [series[s] for s in starts]
    rows[-1]["partial"] = True
    total = sum(r["done"] for r in rows)
    return {"weeks": rows, "total": total, "this_week": rows[-1]["done"],
            "say": (f"{rows[-1]['done']} sections this week, {total} in the last {weeks} weeks." if total
                    else f"No section ticked in the last {weeks} weeks.")}


def progress(kv, bank: dict, today: str, node: Optional[str] = None, weeks: int = WEEKS_DEFAULT) -> dict:
    """The Library / phone card payload: every resource with a checklist (or, for a node, every
    resource of that node, with or without), plus the weekly series."""
    st = _load(kv)
    resources = bank.get("resources") or {}
    if node is not None:
        n = (bank.get("nodes") or {}).get(node)
        if n is None:
            raise ValueError(f"unknown node: {node}")
        rids = [r for r in n["resources"] if r in resources]
    else:
        rids = [r for r in resources if (st["lists"].get(r) or {}).get("items")]
    rows = [summary(bank, r, st["lists"].get(r), today) for r in rids]
    without = sum(1 for r in resources if not (st["lists"].get(r) or {}).get("items"))
    return {"date": today, "node": node, "resources": rows, "without_list": without, "weekly": weekly(kv, bank, today, weeks),
            "empty": not rows,
            "say": ("Nothing has a checklist yet." if not rows and node is None else
                    "This node has no resources." if not rows else
                    f"{sum(1 for r in rows if r['has_list'])} of {len(rows)} resources have a checklist.")}
