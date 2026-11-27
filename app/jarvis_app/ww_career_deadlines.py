"""Deadline rows (wave EW10, package KB): each application or deadline carries the documents it needs and their lead times.

    Deadlines(path, today, inputs_of, apps_of)
        .view(rs)                       K-05 every row soonest first, its documents with start_by, the switch
        .put(row_id, body, rs)          K-06 his documents, a closing date or a "checked on" date for one row
        .remind(row_id, rs)             K-07 one reminder a document at its start_by, through the app's reminder service
        .set_settings(body, rs)         the auto_remind switch, off by default

Where a row comes from. Two stores he already owns, both read only here:
  * the `deadlines` of his inputs file (ww_engines.load_inputs: id, title, date, kind). Row id "in." + that id. The
    inputs give a deadline without an id the id "dl-<slug of title>-<date>"; here the date is dropped ("in.dl-<slug>")
    when no other such deadline has that title, because dates move and the row must keep its documents when one does
    (review of 27 Nov). Two id-less deadlines with one title keep their dated ids.
  * his applications (germoney.Applications.all(): id, org, programme, closes, status). Row id "app." + that id.
The example inputs file is fictional, so its deadlines are never listed as his (simulated is never shown as measured).

What he adds lives in one file of its own, keyed by the row id, written atomically, with a schema number:
    {"schema": 1, "settings": {"auto_remind": false},
     "rows": {row_id: {"requires": [{doc, lead_days, ready}], "closes": date|null, "checked_on": date|null,
                       "reminders": {doc_key: {"reminder_id", "start_by"}}}}}

Arithmetic. The only sum is start_by = closes - lead_days, on his dates. days_left counts from today in local time.
A row whose checked_on is missing or older than 30 days is stale and says since when.

Reminders. None exists until he presses K-07, or until he has switched auto_remind on and then saves a row's documents.
A second press answers the reminders already raised. A document whose start_by is past is listed as late and gets no
reminder; a ready document gets none. When a saved change moves a document's start_by (a new closes or lead_days),
removes a document or marks it ready, its pending reminder is cancelled through the same service and the answer names
it; the next press (or the switch) raises the new one. A start_by moved upstream (his application or his inputs got
a new date) is noted on GET and the old reminder is cancelled by the next press, so one document never holds two.
With the switch on, a reminder he cancelled by hand is not raised again by a save; his press raises it. Switching off
keeps the reminders already raised. Nothing here opens a socket or sends anything anywhere.
"""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

from .paths import DATA
from .ww_pyq.api import Busy

SCHEMA = 1
FILE = DATA / "ww_career" / "deadlines.json"
STALE_DAYS = 30                 # the plan's rule (9.0, KB): a date not checked in 30 days may have moved on the site
MAX_LEAD_DAYS = 365             # a year of lead: longer than any document he named in the audit needs
MAX_DOCS = 20                   # the contract's ceiling; the applications store caps requirements at 20 too
MAX_DOC_CHARS = 120
REMIND_HOUR = 9                 # a reminder on the morning of start_by leaves the whole day to begin the document
ROW_ID = re.compile(r"^(app|in)\.[\w.\-]{1,120}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_LOCK = threading.Lock()        # one writer: a double press must never raise two reminders for one document


class Unreadable(Busy):
    """His file of deadline rows cannot be read. A write would overwrite what he typed, so every write is refused
    (409, through api.guard's Busy mapping) until the file is fixed or moved away."""


def _date(v: Any, what: str) -> date:
    if not isinstance(v, str) or not _DATE.match(v):
        raise ValueError(f"{what} must be a date like 2026-12-31.")
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise ValueError(f"{what} must be a real date like 2026-12-31.")


def _doc_key(name: str) -> str:
    return name.casefold()


def _clean_doc_name(v: Any) -> str:
    if not isinstance(v, str):
        raise ValueError("Each document needs a name.")
    name = re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", v)).strip()
    if not name:
        raise ValueError("Each document needs a name.")
    if len(name) > MAX_DOC_CHARS:
        raise ValueError(f"A document name is at most {MAX_DOC_CHARS} characters.")
    return name


def _lead(v: Any) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise ValueError("lead_days must be a whole number of days.")
    if v < 0 or v > MAX_LEAD_DAYS:
        raise ValueError(f"lead_days must be from 0 to {MAX_LEAD_DAYS}.")
    return v


def _is_date(v: Any) -> bool:
    try:
        _date(v, "a date")
        return True
    except ValueError:
        return False


def _valid_row(mine: Any) -> bool:
    """A row of his file as this module writes it; anything else means the file was changed by hand or damaged."""
    if not isinstance(mine, dict):
        return False
    if any(mine.get(k) is not None and not _is_date(mine.get(k)) for k in ("closes", "checked_on")):
        return False
    docs = mine.get("requires", [])
    if not isinstance(docs, list) or not all(
            isinstance(d, dict) and isinstance(d.get("doc"), str) and d["doc"]
            and isinstance(d.get("lead_days"), int) and not isinstance(d.get("lead_days"), bool) for d in docs):
        return False
    rem = mine.get("reminders", {})
    return isinstance(rem, dict) and all(isinstance(v, dict) for v in rem.values())


def _app_title(a: dict) -> str:
    org, prog = str(a.get("org") or "").strip(), str(a.get("programme") or "").strip()
    return f"{org}: {prog}" if org and prog else (org or prog or str(a.get("id") or ""))


class Deadlines:
    def __init__(self, path: Optional[Path] = None, today: Optional[Callable[[], date]] = None,
                 inputs_of: Optional[Callable[[], dict]] = None, apps_of: Optional[Callable[[], list]] = None):
        self.path = Path(path) if path is not None else FILE
        self.today = today or date.today
        self.inputs_of = inputs_of or (lambda: {})
        self.apps_of = apps_of or (lambda: [])

    # ------------------------------------------------------------------ his file
    def _read(self) -> dict:
        """His overlay. A missing file is an empty one; one that cannot be read raises Unreadable."""
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {"schema": SCHEMA, "settings": {"auto_remind": False}, "rows": {}}
        except OSError as e:
            raise Unreadable(f"The deadline-rows file could not be read ({type(e).__name__}); nothing was changed.")
        try:
            st = json.loads(raw)
        except ValueError:
            raise Unreadable("The deadline-rows file is not valid JSON; nothing was changed. Fix or move it to start again.")
        if not isinstance(st, dict) or st.get("schema") != SCHEMA or not isinstance(st.get("rows", {}), dict):
            raise Unreadable(f"The deadline-rows file is not schema {SCHEMA}; nothing was changed.")
        st.setdefault("rows", {})
        for rid, mine in st["rows"].items():
            if not _valid_row(mine):
                raise Unreadable(f"The deadline-rows file has a row ({str(rid)[:60]}) it cannot read; nothing was changed.")
        s = st.get("settings") if isinstance(st.get("settings"), dict) else {}
        st["settings"] = {"auto_remind": s.get("auto_remind") is True}
        return st

    def _write(self, st: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps({**st, "schema": SCHEMA}, indent=1, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)

    # ------------------------------------------------------------------ the rows
    def sources(self) -> tuple[dict[str, dict], list[str]]:
        """{row_id: base row} from his inputs and his applications, and the notes on what was left out."""
        rows: dict[str, dict] = {}
        notes: list[str] = []
        try:
            inp = self.inputs_of() or {}
        except Exception:               # a broken inputs file reads as none; the note says so
            inp, notes = {}, notes + ["Your inputs file could not be read, so its deadlines are not listed."]
        if inp.get("source") not in (None, "private"):
            if inp.get("deadlines"):
                notes.append("Your inputs file is missing; the deadlines of the example file are not yours and are not listed.")
        else:
            from .ww_engines import _slug       # the inputs' own rule for an id-less deadline, so the two never drift
            dls = [x for x in inp.get("deadlines") or [] if isinstance(x, dict) and x.get("id")]
            typed = {str(x["id"]) for x in dls}

            def made(x: dict) -> Optional[str]:
                """The slug when the inputs made this id from the title and the date (none was typed)."""
                s = _slug(str(x.get("title") or ""))
                return s if str(x["id"]) == f"dl-{s}-{x.get('date')}" else None
            titles = [made(x) for x in dls]
            for x, s in zip(dls, titles):
                did = str(x["id"])
                if s and titles.count(s) == 1 and f"dl-{s}" not in typed:
                    did = f"dl-{s}"             # dated ids would orphan his documents every time the date moves
                rid = "in." + re.sub(r"[^\w.\-]", "-", did)[:120]
                if rid in rows:
                    notes.append(f"Two deadlines in your inputs read as {rid}; the second is not listed.")
                    continue
                rows[rid] = {"id": rid, "title": str(x.get("title") or x["id"])[:200], "kind": str(x.get("kind") or "other"),
                             "from": "inputs", "status": None, "base_closes": x.get("date") if isinstance(x.get("date"), str) else None}
        try:
            apps = list(self.apps_of() or [])
        except Exception:
            apps, notes = [], notes + ["Your applications could not be read, so they are not listed."]
        for a in apps:
            if not isinstance(a, dict) or not a.get("id"):
                continue
            rid = "app." + re.sub(r"[^\w.\-]", "-", str(a["id"]))[:120]
            if rid in rows:
                continue
            rows[rid] = {"id": rid, "title": _app_title(a)[:200], "kind": "application", "from": "applications",
                         "status": a.get("status"), "base_closes": a.get("closes") if isinstance(a.get("closes"), str) else None}
        return rows, notes

    def _row(self, base: dict, mine: dict, rs: Any, today: date) -> dict:
        closes = mine.get("closes") or base.get("base_closes")
        try:
            cl = date.fromisoformat(closes) if closes else None
        except ValueError:
            cl, closes = None, None
        checked = mine.get("checked_on")
        if not checked:
            stale, why = True, "date not checked since it was entered: no check on file"
        else:
            age = (today - date.fromisoformat(checked)).days
            stale = age > STALE_DAYS
            why = f"date not checked since {checked}" if stale else None
        held = mine.get("reminders") or {}
        reqs = []
        for d in mine.get("requires") or []:
            sb = cl - timedelta(days=d["lead_days"]) if cl else None
            entry = held.get(_doc_key(d["doc"]))
            rid = None
            if entry and sb and entry.get("start_by") == sb.isoformat():
                rid = entry.get("reminder_id")
                if rs is not None:
                    r = rs.get(rid) if rid else None
                    rid = rid if r and r.get("status") in ("pending", "done") else None
            reqs.append({"doc": d["doc"], "lead_days": d["lead_days"], "start_by": sb.isoformat() if sb else None,
                         "ready": bool(d.get("ready")), "late": bool(sb and sb < today and not d.get("ready")),
                         "reminder_id": rid})
        todo = sorted(r["start_by"] for r in reqs if r["start_by"] and not r["ready"])
        return {"id": base["id"], "title": base["title"], "kind": base["kind"], "from": base["from"], "status": base["status"],
                "closes": closes, "closes_typed": bool(mine.get("closes")),
                "days_left": (cl - today).days if cl else None, "checked_on": checked, "stale": stale, "stale_reason": why,
                "requires": reqs, "next_start_by": todo[0] if todo else None}

    @staticmethod
    def _order(r: dict):
        # soonest first: rows still open by their closing day, then rows already closed (most recent first), then undated
        if r["days_left"] is None:
            return (2, 0, r["id"])
        return (0, r["days_left"], r["id"]) if r["days_left"] >= 0 else (1, -r["days_left"], r["id"])

    # ------------------------------------------------------------------ K-05
    def view(self, rs: Any = None) -> dict:
        today = self.today()
        bases, notes = self.sources()
        fault = None
        try:
            with _LOCK:                 # on Windows os.replace fails while another thread has the file open
                st = self._read()
        except Unreadable as e:
            st, fault = {"settings": {"auto_remind": False}, "rows": {}}, str(e)
        items = sorted((self._row(b, st["rows"].get(rid) or {}, rs, today) for rid, b in bases.items()), key=self._order)
        moved = 0
        for rid, b in bases.items():
            for _key, entry, _r, _why in self._mismatched(b, st["rows"].get(rid) or {}, today):
                if rs is not None and (rs.get(entry.get("reminder_id") or "") or {}).get("status") == "pending":
                    moved += 1
        if moved:
            notes.append(f"{moved} pending {'reminder was' if moved == 1 else 'reminders were'} raised for a start date that "
                         "has moved since (a new closing date, lead or ready mark); press Remind on the row to replace them.")
        orphans = []
        for rid, mine in sorted(st["rows"].items()):
            if rid in bases:
                continue
            held = [v.get("reminder_id") for v in (mine.get("reminders") or {}).values() if v.get("reminder_id")]
            if rs is not None:
                held = [x for x in held if (rs.get(x) or {}).get("status") == "pending"]
            reason = "This row is no longer in your inputs or your applications; what you typed for it is kept."
            if held:
                # they were raised for a deadline he may have dropped: say they still fire, and where to stop them
                one = len(held) == 1
                reason += (f" Its {len(held)} pending {'reminder still goes' if one else 'reminders still go'} off;"
                           f" cancel {'it' if one else 'them'} in Reminders if this deadline is gone.")
            orphans.append({"id": rid, "documents": [d["doc"] for d in mine.get("requires") or []], "pending_reminders": held,
                            "reason": reason})
        return {"items": items, "orphans": orphans, "auto_remind": st["settings"]["auto_remind"], "notes": notes,
                "fault": fault, "today": today.isoformat()}

    def row(self, row_id: str, rs: Any = None) -> dict:
        self.check_id(row_id)
        bases, _ = self.sources()
        if row_id not in bases:
            raise KeyError("No such deadline row in your inputs or your applications.")
        with _LOCK:
            st = self._read()
        return self._row(bases[row_id], st["rows"].get(row_id) or {}, rs, self.today())

    @staticmethod
    def check_id(row_id: Any) -> str:
        # fullmatch: match()'s "$" also takes a trailing newline (a URL ending in %0A)
        if not isinstance(row_id, str) or not ROW_ID.fullmatch(row_id):
            raise ValueError("A row id is app.<application id> or in.<deadline id>.")
        return row_id

    # ------------------------------------------------------------------ K-06
    def put(self, row_id: str, body: Any, rs: Any = None) -> dict:
        self.check_id(row_id)
        if not isinstance(body, dict) or not body or set(body) - {"requires", "closes", "checked_on"}:
            raise ValueError("Send {requires?: [{doc, lead_days, ready?}], closes?, checked_on?}.")
        today = self.today()
        with _LOCK:
            bases, _ = self.sources()
            if row_id not in bases:
                raise KeyError("No such deadline row in your inputs or your applications.")
            st = self._read()
            mine = dict(st["rows"].get(row_id) or {})
            if "requires" in body:
                docs = body["requires"]
                if not isinstance(docs, list):
                    raise ValueError("requires is a list of {doc, lead_days, ready?}.")
                if len(docs) > MAX_DOCS:
                    raise ValueError(f"At most {MAX_DOCS} documents a row.")
                before = {_doc_key(d["doc"]): d for d in mine.get("requires") or []}
                clean, seen = [], set()
                for d in docs:
                    if not isinstance(d, dict) or set(d) - {"doc", "lead_days", "ready"}:
                        raise ValueError("Each document is {doc, lead_days, ready?}.")
                    name = _clean_doc_name(d.get("doc"))
                    if _doc_key(name) in seen:
                        raise ValueError(f"The document {name} is listed twice.")
                    seen.add(_doc_key(name))
                    if "ready" in d and not isinstance(d["ready"], bool):
                        raise ValueError("ready is true or false.")
                    ready = d["ready"] if "ready" in d else bool((before.get(_doc_key(name)) or {}).get("ready"))
                    clean.append({"doc": name, "lead_days": _lead(d.get("lead_days")), "ready": ready})
                mine["requires"] = clean
            if "closes" in body:
                # null gives the date back to his inputs or his application; a typed date replaces it here only
                mine["closes"] = None if body["closes"] is None else _date(body["closes"], "closes").isoformat()
            if "checked_on" in body:
                if body["checked_on"] is None:
                    mine["checked_on"] = None
                else:
                    c = _date(body["checked_on"], "checked_on")
                    if c > today:
                        raise ValueError("checked_on cannot be after today.")
                    mine["checked_on"] = c.isoformat()
            cancelled = self._drop_moved(bases[row_id], mine, rs, today)
            st["rows"][row_id] = mine
            self._write(st)
            raised = None
            # a new closes moves every start_by: with the switch on, the reminders it cancelled must come back at once,
            # or he is left with none while believing the switch keeps them
            if ("requires" in body or "closes" in body) and st["settings"]["auto_remind"] and rs is not None:
                raised = self._raise(row_id, bases[row_id], st, rs, today, auto=True)
        return {"row": self._row(bases[row_id], mine, rs, today), "cancelled": cancelled, "auto": raised}

    def _mismatched(self, base: dict, mine: dict, today: date) -> list[tuple]:
        """(key, entry, doc row or None, why) for each held reminder the row no longer matches."""
        now = self._row(base, {**mine, "reminders": {}}, None, today)
        want = {_doc_key(r["doc"]): r for r in now["requires"]}
        out = []
        for key, entry in (mine.get("reminders") or {}).items():
            r = want.get(key)
            if r and not r["ready"] and r["start_by"] == entry.get("start_by"):
                continue
            out.append((key, entry, r, "removed" if r is None else "ready" if r["ready"] else "start_by moved"))
        return out

    def _drop_moved(self, base: dict, mine: dict, rs: Any, today: date) -> list[dict]:
        """Cancel the pending reminders the new row no longer matches: a document removed or ready, or a start_by moved."""
        held = dict(mine.get("reminders") or {})
        out = []
        for key, entry, r, why in self._mismatched(base, mine, today):
            rid = entry.get("reminder_id")
            done = rs.cancel(rid) if (rs is not None and rid) else None
            out.append({"doc": r["doc"] if r else key, "reminder_id": rid, "why": why, "cancelled": done is not None})
            if rs is None and rid:
                continue                # no service to cancel through: keep it on file so a later press still can
            held.pop(key)
        mine["reminders"] = held
        return out

    # ------------------------------------------------------------------ K-07
    def remind(self, row_id: str, rs: Any) -> dict:
        self.check_id(row_id)
        today = self.today()
        with _LOCK:
            bases, _ = self.sources()
            if row_id not in bases:
                raise KeyError("No such deadline row in your inputs or your applications.")
            st = self._read()
            out = self._raise(row_id, bases[row_id], st, rs, today)
        return out

    def _raise(self, row_id: str, base: dict, st: dict, rs: Any, today: date, auto: bool = False) -> dict:
        """One reminder a document that is not ready and whose start_by is today or later; the ones already raised are
        answered, not raised again. Writes his file only when something changed."""
        mine = st["rows"].setdefault(row_id, {})
        # a start_by moved upstream (his application or inputs got a new date) leaves the old reminder pending for the
        # old day; it goes first, or the new one beside it would make two for one document
        cancelled = self._drop_moved(base, mine, rs, today)
        row = self._row(base, {**mine, "reminders": {}}, None, today)
        held = mine.setdefault("reminders", {})
        lines, changed = [], bool(cancelled)
        for r in row["requires"]:
            key, sb = _doc_key(r["doc"]), r["start_by"]
            line = {"doc": r["doc"], "start_by": sb, "reminder_id": None, "due": None}
            if r["ready"]:
                lines.append({**line, "state": "ready"})
                continue
            if sb is None:
                lines.append({**line, "state": "no_date"})
                continue
            if r["late"]:
                lines.append({**line, "state": "late"})
                continue
            entry = held.get(key)
            if entry and entry.get("start_by") == sb:
                old = rs.get(entry.get("reminder_id")) if entry.get("reminder_id") else None
                if old is not None and old.get("status") in ("pending", "done"):
                    lines.append({**line, "state": "already", "reminder_id": old["id"], "due": old["due"]})
                    continue
                if auto:
                    # he cancelled it by hand (or it is gone from the list); a save is not a request to bring it back
                    lines.append({**line, "state": "cancelled_by_you"})
                    continue
            when = datetime.combine(date.fromisoformat(sb), datetime.min.time()).replace(hour=REMIND_HOUR).timestamp()
            when = max(when, rs.clock() + 60)        # start_by is today and 9:00 has passed: remind in a minute
            text = f"Start {r['doc']} for {row['title']}"[:160] + f": it closes {row['closes']}."
            try:
                made = rs.create(text=text, kind="reminder", due=when, origin="career")
            except ValueError as e:                   # the reminder service holds at most a year and a bit ahead
                lines.append({**line, "state": "not_raised", "why": str(e)})
                continue
            held[key] = {"reminder_id": made["id"], "start_by": sb}
            changed = True
            lines.append({**line, "state": "raised", "reminder_id": made["id"], "due": made["due"]})
        if changed:
            self._write(st)
        return {"reminders": lines, "cancelled": cancelled, "raised": sum(x["state"] == "raised" for x in lines),
                "already": sum(x["state"] == "already" for x in lines), "late": [x["doc"] for x in lines if x["state"] == "late"],
                "row": self._row(base, mine, rs, today)}

    # ------------------------------------------------------------------ settings
    def set_settings(self, body: Any) -> dict:
        if not isinstance(body, dict) or set(body) != {"auto_remind"} or not isinstance(body["auto_remind"], bool):
            raise ValueError("Send {auto_remind: true or false}.")
        with _LOCK:
            st = self._read()
            st["settings"] = {"auto_remind": body["auto_remind"]}
            self._write(st)
        return st["settings"]
