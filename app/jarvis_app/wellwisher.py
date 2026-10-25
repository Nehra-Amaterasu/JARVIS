"""Well Wisher v1: the "System" layer on top of the Mission plan engine (germoney.py).

The System advises; it never decides. Two parts live here, both pure functions over
the plan state that germoney.Plan owns (one key, one writer):

  * the Status window: stats derived from logged actions only. Every stat comes
    with the numbers it was computed from and a sentence saying how, so a stat can
    be checked by hand. Nothing moves a stat except a logged action (a contract
    finished, time logged, a learning entry, a quest session, a link to shipped
    work). XP from the window games and manual "mark as mastered" claims are shown
    as "not counted".
  * quest lines: optional life domains beyond study (v1: fitness, a calisthenics
    progression). A quest adds one small daily contract; a level goes up only when
    the level's standard is logged on two different days.

The plan keeps its last 1500 events. So that trimming never makes a stat drop,
Plan.save() folds the trimmed events into st["archive"] first (fold_events).

Design: docs/well-wisher-v1.md.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Optional

QUESTLINES_FILE = "questlines.json"
# What counts as a logged action (a day with one of these is an active day).
ACTION_KINDS = ("contract", "log", "learning", "quest", "ship", "cert", "project", "achievement")
TIMED_KINDS = ("contract", "log", "learning")          # their minutes are focus time
UNITS = ("reps", "seconds")
MAX_SETS = 10

# Rank-ups need proof: every requirement is counted from evidence, never from XP.
RANKS: list[tuple[str, dict[str, int]]] = [
    ("E", {}),
    ("D", {"hours": 10, "nodes": 1}),
    ("C", {"hours": 40, "nodes": 4, "proof": 5}),
    ("B", {"hours": 120, "nodes": 10, "proof": 15, "projects": 1}),
    ("A", {"hours": 300, "nodes": 20, "proof": 40, "projects": 3, "certs": 1}),
    ("S", {"hours": 600, "nodes": 35, "proof": 80, "projects": 6, "certs": 3}),
]
REQ_NAMES = {"hours": "focus hours logged", "nodes": "skill-tree nodes mastered with a finished contract",
             "proof": "proof points (links to finished work)", "projects": "projects shipped with a link",
             "certs": "certificates with a link"}

# Domains named in the brief that have no quest line yet (docs/well-wisher-v1.md, "Deferred").
DEFERRED_DOMAINS = [
    {"id": "money", "name": "Money: skills for income", "status": "planned",
     "why": "Needs a source of real evidence (a paid gig, an invoice, a portfolio link) before it can count anything."},
    {"id": "social", "name": "Social: articulation", "status": "planned",
     "why": "Needs a way to log a real conversation or a recorded explanation without storing anyone else's words."},
]


# ------------------------------------------------------------------ quest-line bank
def _pos_int(v: Any) -> Optional[int]:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def load_questlines(directory: Optional[Path] = None) -> dict:
    """questlines.json from the bank folder, cleaned. A bad level or track is dropped
    with a warning; a missing file means no quest lines (never an error)."""
    from . import germoney
    p = (directory or germoney.bank_dir()) / QUESTLINES_FILE
    out: dict = {"lines": {}, "order": [], "warnings": []}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return out
    for ln in (raw.get("lines") if isinstance(raw, dict) else None) or []:
        if not isinstance(ln, dict) or not ln.get("id"):
            continue
        tracks = []
        for t in ln.get("tracks") or []:
            levels = []
            for lv in (t.get("levels") if isinstance(t, dict) else None) or []:
                n, sets, target = _pos_int(lv.get("n")), _pos_int(lv.get("sets")), _pos_int(lv.get("target"))
                if not (n and sets and target and lv.get("name") and lv.get("unit") in UNITS) or sets > MAX_SETS:
                    out["warnings"].append(f"{ln['id']}/{(t or {}).get('id')}: a bad level dropped")
                    continue
                levels.append({"n": n, "name": str(lv["name"]), "sets": sets, "target": target, "unit": lv["unit"],
                               "cue": str(lv.get("cue") or "")})
            levels.sort(key=lambda x: x["n"])
            if t.get("id") and levels:
                tracks.append({"id": str(t["id"]), "name": str(t.get("name") or t["id"]), "levels": levels})
        if not tracks:
            out["warnings"].append(f"{ln['id']}: no usable tracks")
            continue
        rule = ln.get("proof_rule") if isinstance(ln.get("proof_rule"), dict) else {}
        out["lines"][ln["id"]] = {
            "id": ln["id"], "name": str(ln.get("name") or ln["id"]), "domain": str(ln.get("domain") or ln["id"]),
            "minutes": _pos_int(ln.get("minutes")) or 15, "session_xp": _pos_int(ln.get("session_xp")) or 10,
            "rank_up_xp": _pos_int(ln.get("rank_up_xp")) or 25, "sessions_to_rank": _pos_int(rule.get("sessions")) or 2,
            "why": str(ln.get("why") or ""), "safety": str(ln.get("safety") or ""), "tracks": tracks}
        out["order"].append(ln["id"])
    return out


def _track(line: dict, tid: str) -> Optional[dict]:
    return next((t for t in line["tracks"] if t["id"] == tid), None)


def _level(track: dict, n: int) -> dict:
    return next((lv for lv in track["levels"] if lv["n"] == n), track["levels"][0])


def quest_record(st: dict, line: dict) -> dict:
    """His record for one line (created off). Counters are kept here, not in the
    events, so trimming the event list never loses a session or a rank-up."""
    rec = st.setdefault("quests", {}).setdefault(line["id"], {})
    rec.setdefault("on", False)
    rec.setdefault("since", None)
    for k in ("levels", "start_levels", "hits", "last", "earned", "sessions"):
        rec.setdefault(k, {})
    for t in line["tracks"]:
        rec["levels"].setdefault(t["id"], t["levels"][0]["n"])
        rec["start_levels"].setdefault(t["id"], rec["levels"][t["id"]])
        rec["hits"].setdefault(t["id"], [])
        rec["earned"].setdefault(t["id"], 0)
        rec["sessions"].setdefault(t["id"], 0)
    return rec


def set_line(st: dict, line: dict, on: bool, levels: Optional[dict], today: str) -> dict:
    """Turn a line on or off. Levels given here are a placement (where he chooses to
    start): they set the work, never a stat; only earned rank-ups count."""
    rec = quest_record(st, line)
    rec["on"] = bool(on)
    if on and not rec["since"]:
        rec["since"] = today
    for tid, n in (levels or {}).items():
        t = _track(line, str(tid))
        n = _pos_int(n)
        if t is None or n is None or n not in {lv["n"] for lv in t["levels"]}:
            raise ValueError(f"no level {n} on track {tid}")
        if rec["levels"][t["id"]] != n:
            rec["levels"][t["id"]] = n
            rec["start_levels"][t["id"]] = n
            rec["hits"][t["id"]] = []
    return rec


def pick_track(line: dict, rec: dict, today: str) -> str:
    """Today's track: one already trained today, else the one rested longest
    (so each muscle group rests between sessions), ties in the line's order."""
    for t in line["tracks"]:
        if rec["last"].get(t["id"]) == today:
            return t["id"]
    return min(line["tracks"], key=lambda t: (rec["last"].get(t["id"]) or "", line["tracks"].index(t)))["id"]


def quest_contract(line: dict, rec: dict, st: dict, today: str, track_id: Optional[str] = None) -> Optional[dict]:
    """One quest contract, shaped like every other contract so the UI and the voice
    need nothing new to show it."""
    t = _track(line, track_id or pick_track(line, rec, today))
    if t is None:
        return None
    n = rec["levels"].get(t["id"], t["levels"][0]["n"])
    lv = _level(t, n)
    top = n >= t["levels"][-1]["n"]
    key = f"quest/{line['id']}/{t['id']}/{today}"
    done = st["contracts"].get(key)
    hits = [d for d in rec["hits"].get(t["id"], [])]
    need = max(0, line["sessions_to_rank"] - len(hits))
    unit = "s" if lv["unit"] == "seconds" else " reps"
    standard = f"{lv['sets']} x {lv['target']}{unit}"
    nxt = None if top else _level(t, n + 1)
    return {
        "key": key, "source": "quest", "slot": "quest", "node_id": None, "node_name": None, "branch": line["domain"],
        "title": f"{line['name']} · {t['name']}: {lv['name']}, {standard}", "minutes": line["minutes"], "xp": line["session_xp"],
        "context": f"Level {n} of {t['levels'][-1]['n']} on {t['name']}. {line['why']}".strip(),
        "steps": ["Two minutes of warm-up: arm circles, hip circles, ten easy squats",
                  f"{lv['sets']} sets of {lv['name']}, aiming for {lv['target']}{unit} each; rest about 90 seconds between sets",
                  "Log the numbers you actually did, set by set"],
        "hint": f"{lv['cue']} {line['safety']}".strip(),
        "success_check": f"Every set at {lv['target']}{unit} or more, with clean form.",
        "why": ("Top level reached: keep it, or log it for the record" if top else
                f"{need} more day{'s' if need != 1 else ''} at this standard unlocks level {n + 1} ({nxt['name']})"),
        "done": bool(done), "verified": bool(done and done.get("verified")),
        "read_first": [], "depends_on": [], "primary": None, "backup": None, "pdfs": [],
        "quest": {"line": line["id"], "track": t["id"], "track_name": t["name"], "level": n, "max_level": t["levels"][-1]["n"],
                  "sets": lv["sets"], "target": lv["target"], "unit": lv["unit"], "hits": hits, "need": need, "top": top},
    }


def parse_key(key: str) -> Optional[tuple[str, str, str]]:
    parts = key.split("/")
    if len(parts) == 4 and parts[0] == "quest" and parts[1] and parts[2] and parts[3]:
        return parts[1], parts[2], parts[3]
    return None


def quest_contracts(lines: dict, st: dict, today: str) -> list[dict]:
    """Today's quest contracts, one per line he turned on."""
    out = []
    for lid in lines["order"]:
        line = lines["lines"][lid]
        rec = (st.get("quests") or {}).get(lid)
        if rec and rec.get("on"):
            c = quest_contract(line, quest_record(st, line), st, today)
            if c:
                out.append(c)
    return out


def clean_sets(sets: Any) -> list[int]:
    if not isinstance(sets, list) or not sets:
        raise ValueError("sets must be a list of numbers, one per set")
    if len(sets) > MAX_SETS:
        raise ValueError(f"at most {MAX_SETS} sets")
    out = []
    for s in sets:
        try:
            n = int(s)
        except (TypeError, ValueError):
            raise ValueError("every set must be a number")
        if not 0 <= n <= 1000:
            raise ValueError("a set must be 0 to 1000")
        out.append(n)
    return out


def record_session(line: dict, rec: dict, track_id: str, sets: list[int], today: str) -> dict:
    """Apply one logged session to his record. Returns what happened. The level goes
    up only when the standard is met on `sessions_to_rank` different days."""
    t = _track(line, track_id)
    if t is None:
        raise KeyError(f"no track {track_id} on {line['id']}")
    n = rec["levels"][t["id"]]
    lv = _level(t, n)
    met = sum(1 for s in sets if s >= lv["target"]) >= lv["sets"]
    rec["sessions"][t["id"]] = int(rec["sessions"].get(t["id"]) or 0) + 1
    rec["last"][t["id"]] = today
    ranked = False
    top = n >= t["levels"][-1]["n"]
    if met and not top:
        hits = rec["hits"].setdefault(t["id"], [])
        if today not in hits:
            hits.append(today)
        if len(hits) >= line["sessions_to_rank"]:
            rec["levels"][t["id"]] = next(x["n"] for x in t["levels"] if x["n"] > n)
            rec["hits"][t["id"]] = []
            rec["earned"][t["id"]] = int(rec["earned"].get(t["id"]) or 0) + 1
            ranked = True
    return {"met": met, "level_before": n, "level_after": rec["levels"][t["id"]], "ranked_up": ranked, "top": top,
            "standard": {"sets": lv["sets"], "target": lv["target"], "unit": lv["unit"]},
            "hits": list(rec["hits"][t["id"]])}


# ------------------------------------------------------------------ the archive
def empty_archive() -> dict:
    return {"events": 0, "minutes": {}, "count": {}, "days": [], "xp_unbacked": 0}


def fold_events(archive: dict, events: list[dict]) -> dict:
    """Fold events that are about to be trimmed into running totals."""
    a = {**empty_archive(), **(archive or {})}
    a["minutes"], a["count"], days = dict(a["minutes"]), dict(a["count"]), set(a["days"])
    for e in events:
        k = e.get("kind") or "?"
        a["events"] += 1
        a["count"][k] = int(a["count"].get(k) or 0) + 1
        if k in TIMED_KINDS:
            a["minutes"][k] = int(a["minutes"].get(k) or 0) + int(e.get("minutes") or 0)
        if k in ACTION_KINDS and e.get("date"):
            days.add(e["date"])
        if k == "xp":
            a["xp_unbacked"] += int(e.get("xp") or 0)
    a["days"] = sorted(days)[-120:]                        # only recent days are ever asked for
    return a


# ------------------------------------------------------------------ the Status window
def _tree_done(bank: dict, st: dict) -> dict[str, list[str]]:
    """Finished skill-tree contracts per node (keys "<node>/<contract>")."""
    out: dict[str, list[str]] = {}
    for key in st["contracts"]:
        nid = key.split("/", 1)[0]
        if "/" in key and nid in bank["nodes"]:
            out.setdefault(nid, []).append(key)
    return out


def evidence(bank: dict, st: dict, today: str) -> dict:
    """Every number the stats use, from logged actions only."""
    arch = {**empty_archive(), **(st.get("archive") or {})}
    evs = st["events"]
    minutes = {k: int(arch["minutes"].get(k) or 0) for k in TIMED_KINDS}
    counts = {k: int(arch["count"].get(k) or 0) for k in ACTION_KINDS}
    for e in evs:
        k = e.get("kind")
        if k in TIMED_KINDS:
            minutes[k] += int(e.get("minutes") or 0)
        if k in ACTION_KINDS:
            counts[k] += 1
    since = (date.fromisoformat(today) - timedelta(days=29)).isoformat()
    days = {d for d in arch["days"] if since <= d <= today}
    days |= {e["date"] for e in evs if e.get("kind") in ACTION_KINDS and e.get("date") and since <= e["date"] <= today}
    tree = _tree_done(bank, st)
    mastered = [n for n in bank["order"] if (st["nodes"].get(n) or {}).get("status") == "mastered"]
    proven = [n for n in mastered if tree.get(n)]
    practice = [k for k in st["contracts"] if k.split("/", 1)[0] in ("practice", "refresh", "acad")]
    verified_contracts = sum(1 for v in st["contracts"].values() if v.get("verified"))
    projects = sum(1 for rec in st["nodes"].values() for p in ((rec.get("attributes") or {}).get("projects") or []) if p.get("url"))
    certs = sum(1 for c in (st.get("certs") or {}).values() if c.get("url"))
    quests = st.get("quests") or {}
    q_sessions = sum(int(v or 0) for rec in quests.values() for v in (rec.get("sessions") or {}).values())
    q_earned = sum(int(v or 0) for rec in quests.values() for v in (rec.get("earned") or {}).values())
    unbacked = int(arch["xp_unbacked"]) + sum(int(e.get("xp") or 0) for e in evs if e.get("kind") == "xp")
    return {"minutes": minutes, "counts": counts, "active_days_30": len(days), "tree_contracts": sum(len(v) for v in tree.values()),
            "mastered": len(mastered), "mastered_proven": len(proven), "mastered_unproven": [n for n in mastered if n not in proven],
            "practice_done": len(practice), "questions": len(st.get("questions_done") or []),
            "verified_contracts": verified_contracts, "projects": projects, "certs": certs,
            "quest_sessions": q_sessions, "quest_rank_ups": q_earned, "xp_unbacked": unbacked,
            "xp_migrated": int(st.get("xp_migrated_from") or 0)}


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def stats(bank: dict, st: dict, today: str) -> list[dict]:
    ev = evidence(bank, st, today)
    m = ev["minutes"]
    total_min = sum(m.values())
    proof = ev["verified_contracts"] + 3 * ev["projects"] + 3 * ev["certs"]
    knowledge = 5 * ev["mastered_proven"] + ev["tree_contracts"]
    vitality = ev["quest_sessions"] + 3 * ev["quest_rank_ups"]
    unproven = ev["mastered_unproven"]
    return [
        {"id": "knowledge", "name": "Knowledge", "value": knowledge,
         "explain": f"5 per node mastered with at least one finished contract ({ev['mastered_proven']}) + 1 per finished "
                    f"skill-tree contract ({ev['tree_contracts']}) = {knowledge}."
                    + (f" Not counted: {_plural(len(unproven), 'node')} marked mastered with no finished contract." if unproven else ""),
         "inputs": {"mastered_proven": ev["mastered_proven"], "tree_contracts": ev["tree_contracts"], "mastered_unproven": len(unproven)}},
        {"id": "focus", "name": "Focus", "value": total_min // 60, "unit": "h",
         "explain": f"Hours logged: {m['contract']} min in contracts + {m['log']} min in the log + {m['learning']} min in "
                    f"learning entries = {total_min} min, counted in whole hours.",
         "inputs": dict(m)},
        {"id": "consistency", "name": "Consistency", "value": ev["active_days_30"], "unit": "/30 days",
         "explain": f"Days in the last 30 (to {today}) with at least one logged action: {ev['active_days_30']}.",
         "inputs": {"active_days_30": ev["active_days_30"]}},
        {"id": "proof", "name": "Proof", "value": proof,
         "explain": f"1 per contract finished with a link ({ev['verified_contracts']}) + 3 per project shipped with a link "
                    f"({ev['projects']}) + 3 per certificate with a link ({ev['certs']}) = {proof}.",
         "inputs": {"verified_contracts": ev["verified_contracts"], "projects": ev["projects"], "certs": ev["certs"]}},
        {"id": "recall", "name": "Recall", "value": ev["practice_done"],
         "explain": f"Practice, refresher and exam contracts finished: {ev['practice_done']} "
                    f"(past-paper questions answered in them: {ev['questions']}).",
         "inputs": {"practice_done": ev["practice_done"], "questions": ev["questions"]}},
        {"id": "vitality", "name": "Vitality", "value": vitality,
         "explain": f"1 per quest session logged ({ev['quest_sessions']}) + 3 per level earned on two days at the standard "
                    f"({ev['quest_rank_ups']}) = {vitality}. Starting levels you chose do not count.",
         "inputs": {"quest_sessions": ev["quest_sessions"], "quest_rank_ups": ev["quest_rank_ups"]}},
    ]


def rank(bank: dict, st: dict, today: str) -> dict:
    ev = evidence(bank, st, today)
    have = {"hours": sum(ev["minutes"].values()) // 60, "nodes": ev["mastered_proven"],
            "proof": ev["verified_contracts"] + 3 * ev["projects"] + 3 * ev["certs"], "projects": ev["projects"], "certs": ev["certs"]}
    cur = RANKS[0][0]
    nxt = None
    for name, req in RANKS:
        if all(have[k] >= v for k, v in req.items()):
            cur = name
        else:
            nxt = (name, req)
            break
    out = {"rank": cur, "have": have, "next": None}
    if nxt:
        out["next"] = {"rank": nxt[0], "missing": [{"req": k, "name": REQ_NAMES[k], "have": have[k], "need": v}
                                                     for k, v in nxt[1].items() if have[k] < v]}
    return out


def advice(st: dict, sts: list[dict], lines: dict) -> list[str]:
    """At most three suggestions. Always phrased as an option, never an order."""
    by = {s["id"]: s for s in sts}
    out = []
    if by["consistency"]["value"] < 8:
        out.append(f"Consistency is {by['consistency']['value']}/30 days. One 15-minute contract today would count.")
    if by["focus"]["value"] >= 5 and by["proof"]["value"] == 0:
        out.append("None of the finished work has a link yet. Adding one GitHub or notes link would start Proof.")
    if by["knowledge"]["inputs"]["mastered_unproven"]:
        out.append("Some nodes are marked mastered without a finished contract. Doing one of their contracts would count them.")
    if lines["order"] and not any((st.get("quests") or {}).get(lid, {}).get("on") for lid in lines["order"]):
        out.append("Optional: the calisthenics quest line adds one 15-minute session a day. It is off until you turn it on.")
    return out[:3]


def status_window(bank: dict, st: dict, today: str, lines: dict, level: dict) -> dict:
    sts = stats(bank, st, today)
    ev = evidence(bank, st, today)
    domains = []
    for lid in lines["order"]:
        line = lines["lines"][lid]
        rec = (st.get("quests") or {}).get(lid) or {}
        domains.append({"id": lid, "name": line["name"], "status": "on" if rec.get("on") else "off", "since": rec.get("since"),
                        "tracks": [{"id": t["id"], "name": t["name"], "level": (rec.get("levels") or {}).get(t["id"], t["levels"][0]["n"]),
                                    "max_level": t["levels"][-1]["n"], "earned": int((rec.get("earned") or {}).get(t["id"]) or 0),
                                    "start_level": (rec.get("start_levels") or {}).get(t["id"], t["levels"][0]["n"]),
                                    "level_name": _level(t, (rec.get("levels") or {}).get(t["id"], t["levels"][0]["n"]))["name"]}
                                   for t in line["tracks"]]})
    domains += [dict(d) for d in DEFERRED_DOMAINS]
    return {"date": today, "rank": rank(bank, st, today), "level": level, "xp": st["xp"], "stats": sts,
            "not_counted": {"xp_from_games": ev["xp_unbacked"], "xp_carried_over": ev["xp_migrated"],
                            "nodes_claimed": ev["mastered_unproven"],
                            "explain": "XP from the window games and XP carried over from the old app have no logged action "
                                       "behind them, so no stat or rank uses them. The XP level still includes them."},
            "advice": advice(st, sts, lines), "domains": domains,
            "rule": "Every stat moves only with a logged action. The System suggests; you decide."}
