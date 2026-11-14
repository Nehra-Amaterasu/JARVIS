"""Wave comms: one board that every agent of every lane reads before it works.

Two chats build the same application at the same time (a UI lane and an engine lane). Parallel builders broke
each other at merge twice on 13 Nov 2026 because each knew only its own brief. The cure that held (wave 5: five
merges, 0 code conflicts) was to give every builder the SAME table: who builds what, in which folders, adding
which exports or routes. This tool keeps that table in one file and prints it as one bulletin, so an orchestrator
pastes the identical text at the top of every agent prompt in both lanes.

The board is one JSON file. By default it lives in the main checkout's private notes
(<main checkout>/data/notes/wave-comms.json), found through git's common directory, so a second worktree sees
the same file in real time; set JARVIS_WAVE_COMMS or pass --board to use another path (tests do).

Every write takes a lock file and replaces the board atomically, so two chats can write at once.

  python tools/wave_comms.py show
  python tools/wave_comms.py claim --lane engine --wave 1 --pkg E05 --purpose "question store" \
      --owns "app/jarvis_app/ww_qstore.py,app/tests/test_ww_qstore.py" --adds "GET /api/ww/questions" --imports ""
  python tools/wave_comms.py status --pkg E05 --state building --note "store schema done"
  python tools/wave_comms.py ask --from ui --to engine --text "need the JSON shape of GET /api/ww/questions"
  python tools/wave_comms.py answer --id 1 --text "see the engine plan file, route R-03"
  python tools/wave_comms.py note --lane ui --text "wave 7 merged at abc1234"
  python tools/wave_comms.py check
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import subprocess
import sys
import time
from pathlib import Path

LANES = ("ui", "engine")
STATES = ("planned", "building", "review", "merged", "blocked", "dropped")
ACTIVE = ("planned", "building", "review", "blocked")
LOCK_WAIT_S = 15.0   # two chats write a few times an hour; 15 s is far above any real hold time
LOCK_STALE_S = 60.0  # a write takes milliseconds, so a lock older than a minute belongs to a dead process
MERGED_SHOWN = 10    # the bulletin is pasted into every prompt: old merged rows only cost tokens

DEFAULT_RULES = [
    "Lanes: the UI lane owns app/ui/**; the engine lane owns app/jarvis_app/**, core/**, app/tests/**, "
    "tools/engine/** and its own docs. Nobody edits a path owned by another package on this board.",
    "A UI package reaches an engine route only through an adapter file it owns, with a null adapter until the "
    "route is merged. Route shapes are written once, in docs/design/well-wisher-engine-plan.md.",
    "Single-source tables (lamp states, tokens, section ids, key bindings, route contracts) are imported or read, "
    "never copied. Never re-implement an export or route another package lists here.",
    "Agents never run git write commands: they leave work uncommitted and report a commit message; the lane's "
    "orchestrator commits, merges and pushes, pulling main first.",
    "Honest states: no number without a state (live, waiting, simulated, planned, fault); nothing generated shown "
    "as measured; no camera; no exam-result or medical claims; no personal details in tracked files.",
    "Shared notes are never rewritten: each lane appends one-line log entries and edits only its own section.",
    "UI work applies the 20 principles in docs/design/ux-principles-checklist.md (animation 1 to 12, usability 13 "
    "to 20) and is judged beside the owner's clay references: soft, refined, nothing outlined by a hairline.",
]


def default_board_path() -> Path:
    env = os.environ.get("JARVIS_WAVE_COMMS")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    try:
        common = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=here, capture_output=True, text=True, check=True,
        ).stdout.strip()
        root = Path(common).parent
    except (OSError, subprocess.CalledProcessError):
        root = here.parent
    return root / "data" / "notes" / "wave-comms.json"


class Lock:
    """An exclusive lock file. os.O_EXCL makes creation atomic on Windows and POSIX alike."""

    def __init__(self, board: Path):
        self.path = board.with_suffix(board.suffix + ".lock")
        self.fd: int | None = None

    def __enter__(self) -> "Lock":
        deadline = time.monotonic() + LOCK_WAIT_S
        while True:
            try:
                self.fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(self.fd, str(os.getpid()).encode())
                return self
            except FileExistsError:
                try:
                    if time.time() - self.path.stat().st_mtime > LOCK_STALE_S:
                        self.path.unlink(missing_ok=True)
                        continue
                except FileNotFoundError:
                    continue
                if time.monotonic() > deadline:
                    raise TimeoutError(f"wave comms board is locked: {self.path}")
                time.sleep(0.05)

    def __exit__(self, *exc) -> None:
        if self.fd is not None:
            os.close(self.fd)
        self.path.unlink(missing_ok=True)


def empty_board() -> dict:
    return {"version": 1, "rules": list(DEFAULT_RULES), "packages": [], "requests": [], "notes": []}


def load(board: Path) -> dict:
    if not board.exists():
        return empty_board()
    data = json.loads(board.read_text(encoding="utf-8"))
    for key, value in empty_board().items():
        data.setdefault(key, value)
    for rule in DEFAULT_RULES:  # a rule added to the tool later reaches a board that already exists
        if rule not in data["rules"]:
            data["rules"].append(rule)
    return data


def save(board: Path, data: dict) -> None:
    board.parent.mkdir(parents=True, exist_ok=True)
    tmp = board.with_suffix(board.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, board)


def stamp() -> str:
    return time.strftime("%Y-%m-%d %H:%M")


def split_list(text: str) -> list[str]:
    return [p.strip().replace("\\", "/") for p in text.replace(";", ",").split(",") if p.strip()]


WILD = "*?["


def seg_overlap(a: str, b: str) -> bool:
    """Can one path segment match a name the other also matches? Literal against pattern uses fnmatch; two patterns
    are compared by their literal prefixes (d03* and d0* can both match d03x; d03* and core* cannot)."""
    wa, wb = any(c in a for c in WILD), any(c in b for c in WILD)
    if not wa and not wb:
        return a == b
    if wa and not wb:
        return fnmatch.fnmatchcase(b, a)
    if wb and not wa:
        return fnmatch.fnmatchcase(a, b)
    pa = a[: min((a.index(c) for c in WILD if c in a))]
    pb = b[: min((b.index(c) for c in WILD if c in b))]
    return pa.startswith(pb) or pb.startswith(pa)


def overlaps(a: str, b: str) -> bool:
    """Two ownership globs clash when some path could belong to both. Compared segment by segment: '**' owns
    everything below it, and a path that ends first is treated as a folder that owns what lies under it.
    (A whole-prefix rule refused app/ui/e2e/core-v2.spec.ts against app/ui/e2e/d03* on the first day.)"""
    sa, sb = a.strip("/").split("/"), b.strip("/").split("/")
    for x, y in zip(sa, sb):
        if x == "**" or y == "**":
            return True
        if not seg_overlap(x, y):
            return False
    return True


def clashes(data: dict, pkg: str, owns: list[str]) -> list[str]:
    found = []
    for other in data["packages"]:
        if other["pkg"] == pkg or other["state"] not in ACTIVE:
            continue
        for mine in owns:
            for theirs in other["owns"]:
                if overlaps(mine, theirs):
                    found.append(f"{mine} overlaps {theirs} of {other['pkg']} ({other['lane']} lane, {other['state']})")
    return found


def find(data: dict, pkg: str) -> dict | None:
    return next((p for p in data["packages"] if p["pkg"] == pkg), None)


def cmd_claim(data: dict, a: argparse.Namespace) -> int:
    owns = split_list(a.owns)
    if not owns:
        print("claim needs at least one owned path", file=sys.stderr)
        return 2
    bad = clashes(data, a.pkg, owns)
    if bad:
        print("REFUSED: ownership clash\n  " + "\n  ".join(bad), file=sys.stderr)
        return 1
    row = find(data, a.pkg)
    if row is None:
        row = {"pkg": a.pkg, "state": "planned", "note": ""}
        data["packages"].append(row)
    row.update(lane=a.lane, wave=a.wave, purpose=a.purpose.strip(), owns=owns,
               adds=split_list(a.adds or ""), imports=split_list(a.imports or ""), updated=stamp())
    print(f"claimed {a.pkg} ({a.lane} lane, wave {a.wave})")
    return 0


def cmd_status(data: dict, a: argparse.Namespace) -> int:
    row = find(data, a.pkg)
    if row is None:
        print(f"unknown package {a.pkg}", file=sys.stderr)
        return 1
    row["state"] = a.state
    if a.note is not None:
        row["note"] = a.note.strip()
    row["updated"] = stamp()
    print(f"{a.pkg} is {a.state}")
    return 0


def cmd_ask(data: dict, a: argparse.Namespace) -> int:
    rid = 1 + max((r["id"] for r in data["requests"]), default=0)
    data["requests"].append({"id": rid, "from": a.sender, "to": a.to, "text": a.text.strip(),
                             "asked": stamp(), "answer": "", "answered": ""})
    print(f"request {rid} filed")
    return 0


def cmd_answer(data: dict, a: argparse.Namespace) -> int:
    req = next((r for r in data["requests"] if r["id"] == a.id), None)
    if req is None:
        print(f"unknown request {a.id}", file=sys.stderr)
        return 1
    req["answer"], req["answered"] = a.text.strip(), stamp()
    print(f"request {a.id} answered")
    return 0


def cmd_note(data: dict, a: argparse.Namespace) -> int:
    data["notes"].append({"lane": a.lane, "text": a.text.strip(), "at": stamp()})
    data["notes"] = data["notes"][-40:]  # the bulletin shows the last few; the rest is in each lane's own log
    print("noted")
    return 0


def cell(text: str) -> str:
    return str(text).replace("|", "/").replace("\n", " ")


def render(data: dict) -> str:
    out = ["WAVE COMMS BULLETIN (the same text goes to every agent of both lanes; read it before you work)", ""]
    out.append("Standing rules:")
    out += [f"{i}. {r}" for i, r in enumerate(data["rules"], 1)]
    out.append("")
    active = [p for p in data["packages"] if p["state"] in ACTIVE]
    merged = [p for p in data["packages"] if p["state"] == "merged"][-MERGED_SHOWN:]
    out.append("In progress (lane | wave | package | state | purpose | owns | adds | may import | note):")
    if not active:
        out.append("(nothing in progress)")
    for p in sorted(active, key=lambda r: (r["lane"], r["wave"], r["pkg"])):
        out.append("| " + " | ".join(cell(x) for x in (
            p["lane"], p["wave"], p["pkg"], p["state"], p["purpose"], ", ".join(p["owns"]),
            "; ".join(p["adds"]) or "-", "; ".join(p["imports"]) or "-", p.get("note") or "-")) + " |")
    out.append("")
    out.append("Recently merged (reuse these, do not rebuild them):")
    if not merged:
        out.append("(none recorded)")
    for p in merged:
        out.append(f"- {p['pkg']} ({p['lane']}): {cell(p['purpose'])}; adds {'; '.join(p['adds']) or '-'}")
    opened = [r for r in data["requests"] if not r["answer"]]
    out.append("")
    out.append("Open requests between lanes:")
    if not opened:
        out.append("(none)")
    for r in opened:
        out.append(f"- #{r['id']} {r['from']} asks {r['to']} ({r['asked']}): {cell(r['text'])}")
    answered = [r for r in data["requests"] if r["answer"]][-5:]
    if answered:
        out.append("Recently answered:")
        for r in answered:
            out.append(f"- #{r['id']} {cell(r['text'])} => {cell(r['answer'])}")
    if data["notes"]:
        out.append("")
        out.append("Latest notes:")
        for n in data["notes"][-6:]:
            out.append(f"- {n['at']} {n['lane']}: {cell(n['text'])}")
    return "\n".join(out) + "\n"


def cmd_check(data: dict) -> int:
    bad = []
    for p in data["packages"]:
        if p["state"] in ACTIVE:
            bad += [f"{p['pkg']}: {c}" for c in clashes(data, p["pkg"], p["owns"])]
    if bad:
        print("OWNERSHIP CLASHES\n  " + "\n  ".join(sorted(set(bad))))
        return 1
    print(f"ok: {sum(1 for p in data['packages'] if p['state'] in ACTIVE)} active package(s), no ownership clash")
    return 0


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="The wave comms board shared by the UI lane and the engine lane.")
    ap.add_argument("--board", type=Path, default=None, help="path of the board file (default: the main checkout's notes)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show", help="print the bulletin to paste into every agent prompt")
    sub.add_parser("check", help="exit 1 when two active packages own overlapping paths")
    c = sub.add_parser("claim", help="add or update a package row; refused on an ownership clash")
    c.add_argument("--lane", choices=LANES, required=True)
    c.add_argument("--wave", type=int, required=True)
    c.add_argument("--pkg", required=True)
    c.add_argument("--purpose", required=True)
    c.add_argument("--owns", required=True, help="comma-separated paths or globs, repository-relative")
    c.add_argument("--adds", default="", help="exports or routes this package adds, separated by ; or ,")
    c.add_argument("--imports", default="", help="exports or routes of other packages it may use")
    s = sub.add_parser("status", help="set a package's state")
    s.add_argument("--pkg", required=True)
    s.add_argument("--state", choices=STATES, required=True)
    s.add_argument("--note", default=None)
    q = sub.add_parser("ask", help="file a request from one lane to the other")
    q.add_argument("--from", dest="sender", choices=LANES, required=True)
    q.add_argument("--to", choices=LANES, required=True)
    q.add_argument("--text", required=True)
    w = sub.add_parser("answer", help="answer a request")
    w.add_argument("--id", type=int, required=True)
    w.add_argument("--text", required=True)
    n = sub.add_parser("note", help="one line for everyone")
    n.add_argument("--lane", choices=LANES, required=True)
    n.add_argument("--text", required=True)
    return ap


def main(argv: list[str] | None = None) -> int:
    a = parser().parse_args(argv)
    board = a.board or default_board_path()
    if a.cmd in ("show", "check"):
        data = load(board)
        if a.cmd == "show":
            sys.stdout.write(render(data))
            return 0
        return cmd_check(data)
    with Lock(board):
        data = load(board)
        code = {"claim": cmd_claim, "status": cmd_status, "ask": cmd_ask, "answer": cmd_answer, "note": cmd_note}[a.cmd](data, a)
        if code == 0:
            save(board, data)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
