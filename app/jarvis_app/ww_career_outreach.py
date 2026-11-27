"""Follow-ups and outreach (EW10 package KC, K-08 to K-10): a follow-up date for every application he has applied to,
counted from the day he applied, and the drafts he writes and marks as sent himself.

    OutreachStore(path)                       outreach.json (atomic, one lock, schema version, a corrupt file set aside)
    default_store() -> OutreachStore          one per process at paths.DATA / "career" / "outreach.json"
    store.add(application, fields)            a draft row, state "draft"
    store.edit(id, fields)                    a draft's text; a sent row is Conflict (409)
    store.mark_sent(id, sent_on)              his own mark after he sent it himself; a second mark is Conflict (409)
    store.set_days(application, days)         the follow-up gap he typed for one application (1 to 120)
    applied_at(application) -> str or None    the first "applied" day of the current round of its history
    followups(applications, store, today)     the K-08 answer, without the envelope

Rules that decided the shape:
- Nothing here sends anything. No socket, mail program or browser is opened; `to_note` is his private note of who a
  draft is for, stored as text, never read as an address, never checked as one and never logged.
- The applied date is read from the dated history germoney.Applications.set_status writes (kept by the views since
  EW10). An application whose status says it was applied but whose history has no applied entry (a PUT that set the
  status, or a file older than the history) is listed under `undated` with a sentence, never given a guessed date.
- follow_up_on is applied_at plus follow_up_days (14 unless he typed another, 1 to 120). Once he marks a message
  sent, it counts from the latest sent_on instead. days_since counts from today in local time.
- A row whose application was later deleted stays on file; its listing says the application is gone, and K-08
  leaves it out because there is nothing left to follow up.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from .ww_pyq import api

SCHEMA_VERSION = 1
STATES = ("draft", "sent")
DEFAULT_DAYS = 14          # two weeks: the usual gap before a polite nudge on an application; he can type 1 to 120
MIN_DAYS, MAX_DAYS = 1, 120
MAX_SUBJECT = 200
MAX_BODY = 20_000          # a long cover note is 3,000 to 5,000 characters; 20,000 leaves room and bounds the file
MAX_TO_NOTE = 500
MAX_APP_ID = 80            # germoney.clean_application cuts an id at 80 characters
APPLIED_STATUSES = ("applied", "interview", "offer", "rejected")   # a status that means he did apply
CLOSED = ("offer", "rejected", "not_eligible")                     # nothing to follow up on (germoney.CLOSED)
UNDATED = "No applied date in its history; set its status to applied to start the follow-up clock."
EDITABLE = ("to_note", "subject", "body", "follow_up_days")
_ID = re.compile(r"^o-[0-9a-f]{12}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_REPLACE_TRIES = 8         # Windows can hold a target for a few ms (antivirus, an open reader)


class Conflict(api.Busy):
    """A second sent mark, or an edit of a message already marked sent: 409 through api.guard."""


def _today() -> date:
    """The local day; a test replaces it."""
    return date.today()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def valid_id(rid: Any) -> bool:
    return isinstance(rid, str) and bool(_ID.fullmatch(rid))


def check_date(v: Any, what: str = "A date") -> date:
    if not isinstance(v, str) or not _DATE.fullmatch(v.strip()):
        raise ValueError(f"{what} is written like 2026-11-27.")
    try:
        return date.fromisoformat(v.strip())
    except ValueError:
        raise ValueError(f"{what} is written like 2026-11-27.")


def check_days(v: Any) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or not MIN_DAYS <= v <= MAX_DAYS:
        raise ValueError(f"The follow-up gap is a whole number of days from {MIN_DAYS} to {MAX_DAYS}.")
    return v


def _text(b: dict, key: str, cap: int, label: str) -> str:
    v = b.get(key, "")
    if v is None:
        v = ""
    if not isinstance(v, str):
        raise ValueError(f"{label} is text.")
    if len(v) > cap:
        raise ValueError(f"{label} is at most {cap:,} characters; this one is {len(v):,}.")
    return v


def check_application_id(v: Any) -> str:
    if not isinstance(v, str) or not v.strip():
        raise ValueError("Say which application this is for.")
    if len(v) > MAX_APP_ID:
        raise ValueError(f"An application id is at most {MAX_APP_ID} characters.")
    return v


class OutreachStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self.problems: list[str] = []      # what was found broken and set aside; every answer prints it

    def _say(self, problem: str) -> None:
        if problem not in self.problems:
            self.problems.append(problem)

    def _load(self, for_write: bool = False) -> dict:
        """The whole file; unknown keys are kept so a later wave's fields survive a round trip."""
        empty = {"version": SCHEMA_VERSION, "rows": [], "follow_up_days": {}}
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return empty
        except OSError as e:
            self._say(f"{self.path.name} could not be read ({type(e).__name__}).")
            if for_write:      # an unreadable file is still his file: writing now would replace it with an empty one
                raise Conflict(f"{self.path.name} could not be read; nothing was written over it.")
            return empty
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("wrong shape")
        except ValueError:
            # set aside, never overwritten: the next write would destroy what he can still recover by hand. The name
            # carries a random part because two bad files in one second shared a name and the second replaced the first.
            aside = self.path.with_name(f"{self.path.name}.{int(time.time())}-{uuid.uuid4().hex[:6]}.corrupt")
            try:
                os.replace(self.path, aside)
            except OSError as e:
                # still in place: every write is refused until it can be moved (review 27 Nov: a held file was written over)
                self._say(f"{self.path.name} could not be parsed and could not be moved aside ({type(e).__name__}); "
                          "nothing will be written over it.")
                if for_write:
                    raise Conflict(f"{self.path.name} could not be parsed or moved aside; nothing was written over it.")
                return empty
            self._say(f"{self.path.name} could not be parsed; kept beside it as {aside.name}.")
            return empty
        rows = data.get("rows") if isinstance(data.get("rows"), list) else []
        good = [r for r in rows if isinstance(r, dict) and valid_id(r.get("id"))
                and r.get("state") in STATES and isinstance(r.get("application"), str)]
        # a row this version cannot read (a later wave's state, a hand edit) is left out of every answer but kept on
        # disk: _save puts it back, so a draft saved today does not erase it
        data["_unread"] = [r for r in rows if not any(r is g for g in good)]
        data["rows"] = good
        days = data.get("follow_up_days")
        data["follow_up_days"] = {k: v for k, v in (days.items() if isinstance(days, dict) else [])
                                  if isinstance(k, str) and isinstance(v, int) and not isinstance(v, bool)
                                  and MIN_DAYS <= v <= MAX_DAYS}
        data.setdefault("version", SCHEMA_VERSION)
        return data

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        out = {k: v for k, v in data.items() if k != "_unread"}
        out["rows"] = list(data["rows"]) + list(data.get("_unread") or [])
        blob = json.dumps(out, ensure_ascii=False, indent=1).encode("utf-8")
        tmp = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex[:8]}.tmp")
        try:
            with open(tmp, "wb") as f:
                f.write(blob)
                f.flush()
                os.fsync(f.fileno())
            for i in range(_REPLACE_TRIES):
                try:
                    os.replace(tmp, self.path)
                    return
                except PermissionError:
                    if i == _REPLACE_TRIES - 1:
                        raise
                    time.sleep(0.02 * (i + 1))
        finally:
            try:
                tmp.unlink()
            except OSError:
                pass

    # ------------------------------------------------------------------ reads
    def rows(self, application: Optional[str] = None) -> list[dict]:
        with self._lock:
            rows = self._load()["rows"]
        if application is not None:
            rows = [r for r in rows if r["application"] == application]
        return [dict(r) for r in rows]

    def get(self, rid: str) -> dict:
        if not valid_id(rid):
            raise KeyError("No such message.")
        for r in self.rows():
            if r["id"] == rid:
                return r
        raise KeyError("No such message.")

    def days_for(self) -> dict[str, int]:
        with self._lock:
            return dict(self._load()["follow_up_days"])

    # ------------------------------------------------------------------ writes
    def set_days(self, application: str, days: int) -> None:
        with self._lock:
            data = self._load(for_write=True)
            data["follow_up_days"][application] = check_days(days)
            self._save(data)

    def add(self, application: str, to_note: str, subject: str, body: str, days: Optional[int] = None) -> dict:
        row = {"id": "o-" + uuid.uuid4().hex[:12], "application": application, "to_note": to_note,
               "subject": subject, "body": body, "state": "draft", "made": _today().isoformat(),
               "updated": _now(), "sent_on": None}
        with self._lock:
            data = self._load(for_write=True)
            data["rows"].append(row)
            if days is not None:
                data["follow_up_days"][application] = check_days(days)
            self._save(data)
        return dict(row)

    def edit(self, rid: str, changes: dict) -> dict:
        """Text changes need a draft; a follow-up gap alone may change on a sent row (it belongs to the application)."""
        if not valid_id(rid):
            raise KeyError("No such message.")
        with self._lock:
            data = self._load(for_write=True)
            row = next((r for r in data["rows"] if r["id"] == rid), None)
            if row is None:
                raise KeyError("No such message.")
            text = {k: v for k, v in changes.items() if k != "follow_up_days"}
            if text and row["state"] != "draft":
                raise Conflict("This message is marked sent; its text stays as you sent it.")
            row.update(text)
            if text:
                row["updated"] = _now()
            if "follow_up_days" in changes:
                data["follow_up_days"][row["application"]] = check_days(changes["follow_up_days"])
            self._save(data)
            return dict(row)

    def mark_sent(self, rid: str, sent_on: date) -> dict:
        if not valid_id(rid):
            raise KeyError("No such message.")
        with self._lock:
            data = self._load(for_write=True)
            row = next((r for r in data["rows"] if r["id"] == rid), None)
            if row is None:
                raise KeyError("No such message.")
            if row["state"] == "sent":
                raise Conflict(f"Already marked sent on {row.get('sent_on')}.")
            row.update(state="sent", sent_on=sent_on.isoformat(), updated=_now())
            self._save(data)
            return dict(row)


_DEFAULTS: dict[str, OutreachStore] = {}
_DEFAULT_LOCK = threading.Lock()


def default_store() -> OutreachStore:
    """One store per process at paths.DATA / "career" / "outreach.json"; paths.DATA is read here so a test can move it."""
    from . import paths
    p = Path(paths.DATA) / "career" / "outreach.json"
    key = str(p)
    with _DEFAULT_LOCK:
        if key not in _DEFAULTS:
            _DEFAULTS[key] = OutreachStore(p)
        return _DEFAULTS[key]


# ------------------------------------------------------------------ the follow-up clock
def title_of(a: dict) -> str:
    return " · ".join(x for x in (a.get("org"), a.get("programme")) if x) or str(a.get("id"))


def applied_at(application: dict) -> Optional[str]:
    """The first "applied" day of the current round; None when the history never says applied (never a guessed date).

    A closed status (offer, rejected, not_eligible) ends a round, so applying again after a rejection starts the clock
    on the new day (review 27 Nov: the first applied day ever made a second round 300 days overdue at once). A slip
    back to idea or preparing does not end a round: the first applied day stays."""
    entries = []
    for h in application.get("history") or []:
        if isinstance(h, dict) and isinstance(h.get("at"), str):
            try:
                entries.append((date.fromisoformat(h["at"]).isoformat(), h.get("status")))
            except ValueError:
                continue
    entries.sort(key=lambda e: e[0])      # stable: entries of one day keep the order set_status wrote them
    start, ended = None, None             # the open round's first applied day; the last closed round's
    for on, status in entries:
        if status in CLOSED:
            if start is not None:
                ended = start
            start = None
        elif status == "applied" and start is None:
            start = on
    # a round that ended (rejected, no new application) is still listed from its day; its closed status keeps it not due
    return start or ended


def _last(rows: list[dict]) -> Optional[dict]:
    if not rows:
        return None
    r = max(rows, key=lambda r: (r.get("sent_on") or r.get("made") or "", r.get("updated") or ""))
    return {"id": r["id"], "subject": r["subject"], "state": r["state"], "made": r.get("made"), "sent_on": r.get("sent_on")}


def followups(applications: list[dict], store: OutreachStore, today: date) -> dict:
    """{items, undated}: one item per application whose history holds the day he applied, due first, then soonest."""
    rows = store.rows()
    typed = store.days_for()
    items, undated = [], []
    for a in applications:
        aid = a.get("id")
        if not isinstance(aid, str):
            continue
        on = applied_at(a)
        if on is None:
            if a.get("status") in APPLIED_STATUSES:
                undated.append({"application": aid, "title": title_of(a), "status": a.get("status"), "reason": UNDATED})
            continue
        mine = [r for r in rows if r["application"] == aid]
        sent = [r["sent_on"] for r in mine if r["state"] == "sent" and isinstance(r.get("sent_on"), str)]
        anchor, counts_from = on, "applied"
        if sent and max(sent) >= on:
            anchor, counts_from = max(sent), "sent"
        days = typed.get(aid, DEFAULT_DAYS)
        due_on = date.fromisoformat(anchor) + timedelta(days=days)
        # due only while he is waiting on an answer: closed, or moved back to idea or preparing, is never due
        open_ = a.get("status") in ("applied", "interview")
        items.append({"application": aid, "title": title_of(a), "status": a.get("status"), "applied_at": on,
                      "follow_up_days": days, "follow_up_days_typed": aid in typed,
                      "counts_from": counts_from, "from_date": anchor, "follow_up_on": due_on.isoformat(),
                      "days_since": (today - date.fromisoformat(anchor)).days,
                      "due": open_ and today >= due_on, "last_outreach": _last(mine)})
    items.sort(key=lambda it: (not it["due"], it["follow_up_on"], it["application"]))
    undated.sort(key=lambda u: u["application"])
    return {"items": items, "undated": undated}
