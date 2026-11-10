"""Gate cases for the depth layer: resource checklists (ww_resources.py) and the knowledge cards
(ww_knowledge.py), on fictional fixtures and an in-memory store. No network, no data dir, no
private file: the learning bank is pointed at a missing file (so the fictional example is used) and
the knowledge folder at a scratch folder.

    python -m jarvis_app.ww_check_depth     print the problems; exit 1 if any
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

from . import ww_knowledge, ww_resources


class MemKV:
    def __init__(self):
        self.d: dict[str, str] = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v):
        self.d[k] = v


class StubPlan:
    """Just enough of germoney.Plan for the exam pool: two papers with topics."""

    def engine(self, name, today):
        return {"papers": [{"id": f"p{i}", "title": f"Paper {i}", "topics": [
            {"key": f"u{i}t{j}", "topic": f"Topic {i}.{j}", "unit_title": f"Unit {i}"} for j in range(4)]} for i in range(2)]}


def bank() -> dict:
    res = {f"r{i}": {"id": f"r{i}", "title": f"Course {i}", "kind": "course", "url": f"https://example.invalid/{i}"} for i in range(3)}
    nodes = {"n1": {"id": "n1", "name": "Signals", "resources": ["r0", "r1"], "outcomes": ["Convolve two sequences", "Read a spectrum"]},
             "n2": {"id": "n2", "name": "Circuits", "resources": ["r2"], "outcomes": []}}
    return {"resources": res, "nodes": nodes, "order": ["n1", "n2"]}


def run() -> dict:
    t0 = time.time()
    problems: list[str] = []
    cases = 0

    def case(name: str, ok: bool, why: str = "") -> None:
        nonlocal cases
        cases += 1
        if not ok:
            problems.append(f"{name}: {why}" if why else name)

    def raises(fn, *a) -> bool:
        try:
            fn(*a)
        except ValueError:
            return True
        return False

    # ---- resources
    b, kv = bank(), MemKV()
    lectures = "\n".join(f"Lecture {n}: topic {n}" for n in range(1, 25))
    r = ww_resources.set_checklist(kv, b, "r0", lectures, "2026-11-10")
    case("checklist typed", r["items"] == 24 and r["kept_marks"] == 0, str(r))
    days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-09", "2026-11-10"]       # two Monday-weeks
    for i in range(10):
        ww_resources.tap(kv, b, "r0", f"lecture-{i + 1}-topic-{i + 1}", "done", days[i % 5])
    s = ww_resources.tap(kv, b, "r0", "lecture-11-topic-11", "skip", "2026-11-10")
    s = ww_resources.tap(kv, b, "r0", "lecture-12-topic-12", "skip", "2026-11-10")
    case("counts from taps", (s["done"], s["skipped"], s["left"], s["pct"]) == (10, 2, 12, 45), str((s["done"], s["skipped"], s["left"], s["pct"])))
    case("bookmark follows the last tap", s["at"]["id"] == "lecture-12-topic-12" and s["next"]["id"] == "lecture-13-topic-13", str(s["at"]) + str(s["next"]))
    w = ww_resources.weekly(kv, b, "2026-11-10", 4)
    case("weekly sums to the done count", w["total"] == 10 and w["weeks"][-1]["partial"] and w["weeks"][-1]["done"] == 4 and w["weeks"][-2]["done"] == 6, str(w["weeks"]))
    ww_resources.tap(kv, b, "r0", "lecture-1-topic-1", "open", "2026-11-10")
    case("undo lowers the week it was in", ww_resources.weekly(kv, b, "2026-11-10", 4)["total"] == 9)
    r = ww_resources.set_checklist(kv, b, "r0", lectures.replace("topic 24", "topic twenty-four"), "2026-11-10")
    case("retyping keeps marks of surviving ids", r["kept_marks"] == 11 and r["dropped_marks"] == 0, str(r))
    case("no checklist is said in words", "No checklist" in ww_resources.progress(kv, b, "2026-11-10", "n2")["resources"][0]["say"])
    case("unknown resource, item and state refused",
         raises(ww_resources.tap, kv, b, "nope", "x", "done", "2026-11-10") and raises(ww_resources.tap, kv, b, "r0", "nope", "done", "2026-11-10")
         and raises(ww_resources.tap, kv, b, "r0", "lecture-2-topic-2", "finished", "2026-11-10") and raises(ww_resources.parse_checklist, "\n \n"))

    # ---- knowledge
    d = Path(tempfile.mkdtemp(prefix="ww-know-"))
    old = {k: os.environ.get(k) for k in ("JARVIS_KNOWLEDGE_DIR", "JARVIS_LEARN_FILE")}
    os.environ["JARVIS_KNOWLEDGE_DIR"] = str(d)
    os.environ["JARVIS_LEARN_FILE"] = str(d / "missing-learn.md")
    try:
        (d / "words.txt").write_text("# fictional\n" + "\n".join(f"word{n} :: meaning {n}" for n in range(40)) + "\nword3 :: meaning 3\n", encoding="utf-8")
        (d / "facts.txt").write_text("\n".join(f"Fact number {n}." for n in range(5)), encoding="utf-8")
        (d / "thoughts.txt").write_text("Only thought.\n", encoding="utf-8")
        kv = MemKV()
        v = ww_knowledge.today_view(kv, "2026-11-10", StubPlan(), b)
        case("six cards, none empty", len(v["tracks"]) == 3 and len(v["lists"]) == 3 and not any(c["empty"] for c in v["tracks"] + v["lists"]), str(v))
        case("a read returns the same cards", ww_knowledge.today_view(kv, "2026-11-10", StubPlan(), b) == v)
        pools = {"word": {f"word{n}" for n in range(40)}}
        seq = [ww_knowledge.refresh(kv, "word", "2026-11-10", StubPlan(), b)["lists"][0]["title"] for _ in range(120)]
        case("words come from the list only", set(seq) <= pools["word"], str(set(seq) - pools["word"]))
        case("no word repeats inside the window of 30", all(len(set(seq[i:i + 30])) == 30 for i in range(len(seq) - 29)), "a repeat inside 30 draws")
        facts = [ww_knowledge.refresh(kv, "fact", "2026-11-10", None, b)["lists"][1]["body"] for _ in range(40)]
        case("a 5-fact pool: no repeat inside 4", all(len(set(facts[i:i + 4])) == 4 for i in range(len(facts) - 3)), "a repeat inside 4 draws")
        one = ww_knowledge.refresh(kv, "thought", "2026-11-10", None, b)["lists"][2]
        case("a pool of one repeats and says so", "repeats" in one["note"], str(one))
        for slot in ("exam", "skill", "life"):
            c = ww_knowledge.refresh(kv, slot, "2026-11-10", StubPlan(), b)["tracks"][ww_knowledge.TRACKS.index(slot)]
            case(f"{slot} track draws a bank item", not c["empty"] and c["source"], str(c))
        (d / "words.txt").unlink()
        e = ww_knowledge.refresh(kv, "word", "2026-11-10", None, b)["lists"][0]
        case("an empty list is said in words", e["empty"] and "words" in e["say"], str(e))
        a = ww_knowledge.draw([{"id": str(i)} for i in range(9)], [], "s")
        c = ww_knowledge.draw([{"id": str(i)} for i in range(9)], [], "s")
        case("same seed, same draw", a == c)
        case("bad slot refused", raises(ww_knowledge.refresh, kv, "colour", "2026-11-10", None, b))
    finally:
        for k, v0 in old.items():
            if v0 is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v0
    return {"cases": cases, "problems": problems, "seconds": round(time.time() - t0, 2)}


if __name__ == "__main__":
    r = run()
    print(r)
    sys.exit(1 if r["problems"] else 0)
