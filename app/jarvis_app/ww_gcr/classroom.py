"""Google Classroom, read only: courses and what their posts attach.

    courses(api)            -> [{id, name, section, state, link, updated}]
    topics(api, course_id)  -> {topic_id: name}
    posts(api, course_id)   -> ([{kind, id, title, text, topic, created, updated, link, due, attachments}], [fault sentences])

A post is a material, a piece of coursework or an announcement. Its attachments are normalised to one shape,
{type: "drive" | "link" | "youtube" | "form", id, title, url}, because the three kinds of post nest them the same way and the
sync only cares about Drive files (the notes, decks and papers) and keeps the rest as links.
"""
from __future__ import annotations

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
                            "due": _due(p) if kind == "coursework" else "", "attachments": attachments(p.get("materials"))})
        except ApiError as e:
            faults.append(f"{kind}s: {e}")
    out.sort(key=lambda p: p["updated"] or p["created"], reverse=True)
    return out, faults
