"""Google Classroom, read only: courses and what their posts attach.

    courses(api)            -> [{id, name, section, state, link, updated}]
    topics(api, course_id)  -> {topic_id: name}
    posts(api, course_id)   -> ([{kind, id, title, text, topic, created, updated, link, due, attachments}], [fault sentences])

A post is a material, a piece of coursework or an announcement. Its attachments are normalised to one shape,
{type: "drive" | "link" | "youtube" | "form", id, title, url}, because the three kinds of post nest them the same way and the
sync only cares about Drive files (the notes, decks and papers) and keeps the rest as links.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone, tzinfo
from typing import Optional

from .api import ApiError, GoogleApi

BASE = "https://classroom.googleapis.com/v1"


def courses(api: GoogleApi, include_archived: bool = True) -> list[dict]:
    states = ["ACTIVE"] + (["ARCHIVED"] if include_archived else [])
    out = []
    for c in api.pages(f"{BASE}/courses", "courses", {"studentId": "me", "courseStates": states, "pageSize": 100}):
        out.append({"id": str(c.get("id", "")), "name": c.get("name", ""), "section": c.get("section", ""),
                    "state": str(c.get("courseState", "")).lower(), "link": c.get("alternateLink", ""),
                    "updated": c.get("updateTime", "")})
    return out


def topics(api: GoogleApi, course_id: str) -> dict[str, str]:
    try:
        return {str(t.get("topicId", "")): t.get("name", "")
                for t in api.pages(f"{BASE}/courses/{course_id}/topics", "topic", {"pageSize": 100})}
    except ApiError:
        return {}                                   # topics only group posts; a course is still read without them


def attachments(materials: Optional[list]) -> list[dict]:
    out = []
    for m in materials or []:
        if "driveFile" in m:
            f = (m["driveFile"] or {}).get("driveFile") or {}
            if f.get("id"):
                out.append({"type": "drive", "id": f["id"], "title": f.get("title", ""), "url": f.get("alternateLink", "")})
        elif "link" in m:
            ln = m["link"] or {}
            out.append({"type": "link", "id": "", "title": ln.get("title", ""), "url": ln.get("url", "")})
        elif "youtubeVideo" in m:
            y = m["youtubeVideo"] or {}
            out.append({"type": "youtube", "id": y.get("id", ""), "title": y.get("title", ""), "url": y.get("alternateLink", "")})
        elif "form" in m:
            fm = m["form"] or {}
            out.append({"type": "form", "id": "", "title": fm.get("title", ""), "url": fm.get("formUrl", "")})
    return out


def _due(cw: dict) -> str:
    d = cw.get("dueDate") or {}
    if not d.get("year"):
        return ""
    return f"{int(d['year']):04d}-{int(d.get('month', 1)):02d}-{int(d.get('day', 1)):02d}"


def due_local(cw: dict, tz: Optional[tzinfo] = None) -> tuple[str, str]:
    """(date, time) of a piece of coursework in local time, "" where Classroom gives none. Classroom sends the due
    date and time in UTC, so a deadline of 23:59 here is 18:29 there and one of 03:00 here falls on the day before
    there: the date is converted together with the time, never alone."""
    d = cw.get("dueDate") or {}
    if not d.get("year"):
        return "", ""
    y, m, day = int(d["year"]), int(d.get("month", 1)), int(d.get("day", 1))
    if "dueTime" not in cw:
        return f"{y:04d}-{m:02d}-{day:02d}", ""
    t = cw.get("dueTime") or {}
    try:
        at = datetime(y, m, day, int(t.get("hours", 0)), int(t.get("minutes", 0)), tzinfo=timezone.utc).astimezone(tz)
    except ValueError:
        return "", ""
    return at.strftime("%Y-%m-%d"), at.strftime("%H:%M")


# What Classroom reports about his own submission, in three plain words. NEW and CREATED are "not turned in yet";
# RECLAIMED_BY_STUDENT is work he took back. Anything else Google may add later reads "unknown", never a guess.
WORK = {"TURNED_IN": "turned_in", "RETURNED": "returned", "NEW": "assigned", "CREATED": "assigned", "RECLAIMED_BY_STUDENT": "assigned"}


def submissions(api: GoogleApi, course_id: str) -> dict[str, dict]:
    """His own submission for each piece of coursework of a course: {coursework id: {work, late, updated}}. Read only:
    Google does not let an outside app turn work in."""
    out: dict[str, dict] = {}
    url = f"{BASE}/courses/{course_id}/courseWork/-/studentSubmissions"
    for s in api.pages(url, "studentSubmissions", {"userId": "me", "pageSize": 100}):
        out[str(s.get("courseWorkId", ""))] = {"work": WORK.get(str(s.get("state", "")), "unknown"), "late": bool(s.get("late")),
                                               "updated": s.get("updateTime", "")}
    return out


CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
CALENDAR_DAYS = 60


def calendar_events(api: GoogleApi, now: Optional[datetime] = None, days: int = CALENDAR_DAYS) -> list[dict]:
    """The events of his own calendar from now for `days` days, repeats written out one by one, oldest first."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    params = {"timeMin": now.strftime(fmt), "timeMax": (now + timedelta(days=days)).strftime(fmt), "singleEvents": "true",
              "orderBy": "startTime", "maxResults": 250}
    out = []
    for e in api.pages(CALENDAR, "items", params, limit=1000):
        start, end = e.get("start") or {}, e.get("end") or {}
        all_day = "date" in start and "dateTime" not in start
        out.append({"id": str(e.get("id", "")), "title": e.get("summary", "") or "(no title)",
                    "start": start.get("dateTime") or start.get("date") or "", "end": end.get("dateTime") or end.get("date") or "",
                    "all_day": all_day, "calendar": "primary", "link": e.get("htmlLink", "")})
    return out


def posts(api: GoogleApi, course_id: str) -> tuple[list[dict], list[str]]:
    """Every post of one course with its attachments, newest first, and the reasons for any kind that could not be read
    (a missing permission for announcements must not hide the materials)."""
    names = topics(api, course_id)
    out: list[dict] = []
    faults: list[str] = []
    plan = (("material", "courseWorkMaterials", "courseWorkMaterial", {"courseWorkMaterialStates": "PUBLISHED"}),
            ("coursework", "courseWork", "courseWork", {"courseWorkStates": "PUBLISHED"}),
            ("announcement", "announcements", "announcements", {"announcementStates": "PUBLISHED"}))
    for kind, path, key, extra in plan:
        try:
            for p in api.pages(f"{BASE}/courses/{course_id}/{path}", key, {"pageSize": 100, **extra}):
                text = p.get("description", "") if kind != "announcement" else p.get("text", "")
                title = p.get("title", "") or (text.strip().splitlines()[0][:80] if text.strip() else kind)
                out.append({"kind": kind, "id": str(p.get("id", "")), "title": title, "text": text,
                            "topic": names.get(str(p.get("topicId", "")), ""), "created": p.get("creationTime", ""),
                            "updated": p.get("updateTime", ""), "link": p.get("alternateLink", ""),
                            "due": _due(p) if kind == "coursework" else "", "attachments": attachments(p.get("materials")),
                            "due_date": due_local(p)[0] if kind == "coursework" else "",
                            "due_time": due_local(p)[1] if kind == "coursework" else ""})
        except ApiError as e:
            faults.append(f"{kind}s: {e}")
    out.sort(key=lambda p: p["updated"] or p["created"], reverse=True)
    return out, faults
