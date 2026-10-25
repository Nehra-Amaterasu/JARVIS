"""Mission Germoney inside JARVIS — the server half.

The phone app kept everything in AsyncStorage on the device and called cloud
services directly. Here the same data lives on this machine and every outside call
goes through the server, so the window never holds a key and nothing breaks when
the network does:

  /api/kv/*                   the stores' storage (same keys as the phone app)
  /api/germoney/ai/*          quests, failure verdicts, resource curation, post
                              drafts — from the LOCAL model (Qwen3-4B via Ollama)
                              with the original prompts; output validated, and a
                              deterministic fallback in the UI if it isn't valid
  /api/germoney/github        public GitHub activity for Rule 1 (no token stored)
  /api/germoney/arxiv         live papers for the syllabus
  /api/germoney/focus         the Crucible's distraction check (foreground window)
  /api/germoney/calendar/*    today's events from a private iCal feed + study blocks
  /api/mission/*              the plan engine (routes_mission.py, rules below): the
                              skill-tree bank, node progress, daily contracts, exam
                              mode, the weekly library rotation, campaigns, the
                              parking lot, the one XP total, and the voice intents

Storage (gitignored, personal): data/app/germoney/kv/*.json, one file per key,
written atomically; the whole folder is snapshotted once a day (14 kept), because
"my progress vanished" is the one bug a progress app cannot have.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import threading
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

from . import github_activity, learn_bank, wellwisher, ww_base, ww_engines, ww_money
from .paths import DATA

ROOT = DATA / "germoney"
KV = ROOT / "kv"
BACKUPS = ROOT / "backups"
CALENDAR = ROOT / "calendar.json"
OLLAMA = "http://127.0.0.1:11434"
MODEL = "qwen3:4b-instruct-2507-q4_K_M"
KEY_RE = re.compile(r"^[@A-Za-z0-9_.:\-]{1,120}$")


# ============================================================== key-value store
class KVStore:
    def __init__(self, root: Path = KV, backups: Path = BACKUPS, keep_days: int = 14):
        self.root, self.backups, self.keep = root, backups, keep_days
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    @staticmethod
    def _check(key: str) -> str:
        if not KEY_RE.match(key):
            raise ValueError("invalid key")
        return key

    def _file(self, key: str) -> Path:
        # Base32 of the key: reversible, filesystem-safe, case-insensitive-safe on Windows.
        name = base64.b32encode(self._check(key).encode()).decode().rstrip("=")
        return self.root / f"{name}.json"

    def get(self, key: str) -> Optional[str]:
        try:
            return json.loads(self._file(key).read_text(encoding="utf-8"))["value"]
        except FileNotFoundError:
            return None

    def set(self, key: str, value: str) -> None:
        if not isinstance(value, str):
            raise ValueError("value must be a string (AsyncStorage semantics)")
        if len(value) > 8_000_000:
            raise ValueError("value too large")
        with self._lock:
            self._daily_backup()
            path = self._file(key)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"key": key, "value": value, "updated": time.time()}), encoding="utf-8")
            tmp.replace(path)                       # atomic on NTFS: never a half-written save

    def delete(self, key: str) -> None:
        with self._lock:
            self._daily_backup()
            self._file(key).unlink(missing_ok=True)

    def keys(self) -> list[str]:
        out = []
        for p in self.root.glob("*.json"):
            try:
                out.append(json.loads(p.read_text(encoding="utf-8"))["key"])
            except (ValueError, KeyError, OSError):
                continue
        return sorted(out)

    def _daily_backup(self) -> None:
        stamp = f"{date.today():%Y-%m-%d}"
        target = self.backups / stamp
        if target.exists() or not any(self.root.glob("*.json")):
            return
        shutil.copytree(self.root, target)
        snaps = sorted(p for p in self.backups.iterdir() if p.is_dir())
        for old in snaps[:-self.keep]:
            shutil.rmtree(old, ignore_errors=True)

    def export_all(self) -> dict[str, str]:
        return {k: self.get(k) for k in self.keys()}

    def import_all(self, data: dict[str, Any]) -> int:
        n = 0
        for k, v in data.items():
            if isinstance(k, str) and KEY_RE.match(k) and isinstance(v, str):
                self.set(k, v)
                n += 1
        return n


# ============================================================== local AI
PERSONA = ("You are the AI core of \"Silicon Frontier OS\", a hardcore productivity engine for an ECE "
           "student grinding toward a VLSI Master's at a top German university (TU9) by 2028. Your tone "
           "is clipped, military, and demanding — like a drill-sergeant flight computer. Never use "
           "flattery, emojis, or soft encouragement. State facts and consequences. Be specific and "
           "actionable.")
CATEGORIES = ("energy", "planning", "distraction", "overreach", "external", "avoidance")
BRANCHES = ("siliconLogic", "theForge", "theChancellor", "general")


def quest_prompt(c: dict) -> str:
    return f"""{PERSONA}

Generate 3-5 daily micro-quests for an operative at RANK {c['level']} ({c['rank']}, {c['phase']}).
Weakest skills needing the most work: {', '.join(c.get('weakestSkills') or []) or 'balanced'}.
Weekly time budget: {c.get('weeklyHours', 20)}h.

Rules:
- Each quest must be a single, hyper-specific, completable-today action (the user freezes on vague tasks). Good: "Write and simulate a 2-to-1 mux in Verilog; view the waveform in GTKWave." Bad: "Learn Verilog."
- Tools are open-source only: Icarus Verilog, Verilator, GTKWave, Yosys. No paid EDA tools.
- Always include at least one German-language quest if the German skill is weak (10h/week German is mandatory).
- XP: micro-task 15-25, harder task 30-45.
- skillBranch: siliconLogic (digital/VLSI/HDL), theForge (programming/tools/projects), theChancellor (German/GRE/applications), or general.

Return ONLY JSON: {{"quests":[{{"title","description","xp","skillBranch"}}]}}"""


def failure_prompt(c: dict) -> str:
    return f"""{PERSONA}

The operative failed to execute today. Interrogation log:
- What happened: "{c['whatHappened']}"
- Energy level (1-5): {c['energy']}
- Self-reported cause: {c['category']}

Analyze the ROOT cause (not the excuse). Prescribe ONE concrete intervention for tomorrow. Deliver one brutal verdict line in character.
- rootCause: one sentence naming the underlying mechanism in THIS log — never just the category word.
- intervention: one action for tomorrow, at most 35 words, with a time or a trigger.
- verdict: one line, at most 20 words.

Return ONLY JSON: {{"rootCause","category","intervention","verdict"}}
category must be one of: energy, planning, distraction, overreach, external, avoidance."""


def knowledge_prompt(c: dict) -> str:
    return f"""{PERSONA}

Curate 3-6 learning resources for a RANK "{c['rank']}" operative studying: "{c['topic']}".
Prioritize free, high-signal material (arXiv papers, specific YouTube lectures, canonical blog posts, open tools).
For each, give a specific searchQuery the app can run to find it.

Return ONLY JSON: {{"items":[{{"title","why","searchQuery","type"}}]}}
type must be one of: paper, video, article, tool."""


def posts_prompt(s: dict) -> str:
    return f"""{PERSONA}
The operative is publishing build-in-public proof of work. Real telemetry:
- Rank: {s['level']} — {s['rank']}
- Current level requirement: {s['requirement']}
- Current commit streak: {s['streak']} days
- Contributions (recent public activity): {s['contributions']}
- Active days (last 28): {s['activeDays']}
- Quests completed: {s['quests']}
- Deep-work hours logged: {s['staminaHours']} | German study hours: {s['germanHours']}
- Recent repositories: {', '.join(s.get('repoNames') or []) or 'none public'}
Write THREE post drafts. Use ONLY the numbers above — invent nothing.
1. platform "LINKEDIN": ~80 words, professional, concrete, no hashtag spam.
2. platform "X": under 280 characters, punchy, first-person.
3. platform "COMMIT": a single line in commit-message style, under 90 characters.
Return ONLY JSON: {{"posts":[{{"platform","text"}}]}}"""


def extract_json(raw: str) -> Any:
    """Best-effort JSON extraction (models sometimes wrap JSON in prose or fences)."""
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    cand = fenced.group(1) if fenced else raw
    start = re.search(r"[\[{]", cand)
    if not start:
        raise ValueError("no JSON in model output")
    end = max(cand.rfind("}"), cand.rfind("]"))
    return json.loads(cand[start.start():end + 1])


def _clip(v: Any, n: int) -> str:
    """Enforce the schema's max length WITHOUT cutting a word in half.

    The phone app's zod schema rejected an over-long field (and fell back to the
    engine); trimming keeps the model's answer instead. The first version sliced
    at n characters and produced "...into Englis" and "Verify completi".
    """
    s = " ".join(str(v or "").split())
    if len(s) <= n:
        return s
    cut = s[: n - 1]
    space = cut.rfind(" ")
    if space > n * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,;:-—") + "…"


def validate(task: str, data: Any) -> dict:
    """The phone app's zod schemas, as plain checks. Raises ValueError if invalid."""
    if task == "quests":
        qs = data.get("quests") if isinstance(data, dict) else None
        if not isinstance(qs, list) or not 3 <= len(qs) <= 5:
            raise ValueError("need 3-5 quests")
        out = []
        for q in qs:
            xp = int(q.get("xp", 0))
            br = q.get("skillBranch")
            if not q.get("title") or not q.get("description") or not 10 <= xp <= 60 or br not in BRANCHES:
                raise ValueError("bad quest")
            out.append({"title": _clip(q["title"], 60), "description": _clip(q["description"], 200),
                        "xp": xp, "skillBranch": br})
        return {"quests": out}
    if task == "failure":
        if not isinstance(data, dict) or data.get("category") not in CATEGORIES:
            raise ValueError("bad failure analysis")
        for k in ("rootCause", "intervention", "verdict"):
            if not data.get(k):
                raise ValueError(f"missing {k}")
        return {"rootCause": _clip(data["rootCause"], 240), "category": data["category"],
                "intervention": _clip(data["intervention"], 240), "verdict": _clip(data["verdict"], 160)}
    if task == "curation":
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list) or not 3 <= len(items) <= 6:
            raise ValueError("need 3-6 items")
        out = []
        for it in items:
            if it.get("type") not in ("paper", "video", "article", "tool") or not it.get("title"):
                raise ValueError("bad item")
            out.append({"title": _clip(it["title"], 100), "why": _clip(it.get("why"), 160),
                        "searchQuery": _clip(it.get("searchQuery") or it["title"], 80), "type": it["type"]})
        return {"items": out}
    if task == "posts":
        posts = data.get("posts") if isinstance(data, dict) else None
        if not isinstance(posts, list) or not posts:
            raise ValueError("no posts")
        return {"posts": [{"platform": _clip(p.get("platform"), 20).upper(), "text": _clip(p.get("text"), 1200)}
                          for p in posts if p.get("text")]}
    raise ValueError(f"unknown task {task}")


PROMPTS = {"quests": quest_prompt, "failure": failure_prompt, "curation": knowledge_prompt, "posts": posts_prompt}


def generate(task: str, ctx: dict, retries: int = 1) -> dict:
    """Run a task on the local model; raise RuntimeError if it can't produce valid JSON."""
    if task not in PROMPTS:
        raise ValueError(f"unknown task {task}")
    prompt = PROMPTS[task](ctx)
    last_err = None
    for _ in range(retries + 1):
        try:
            r = httpx.post(f"{OLLAMA}/api/generate", timeout=90, json={
                "model": MODEL, "prompt": prompt, "stream": False, "format": "json",
                "options": {"temperature": 0.4, "num_predict": 700}, "keep_alive": "30m"})
            r.raise_for_status()
            return validate(task, extract_json(r.json().get("response", "")))
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
            last_err = e
    raise RuntimeError(f"local model gave no valid {task}: {last_err}")


# ============================================================== GitHub (public)
def github_summary(user: str) -> dict:
    """Recent public push activity + repos — enough for Rule 1, with no token stored."""
    if not re.match(r"^[A-Za-z0-9-]{1,39}$", user or ""):
        raise ValueError("invalid GitHub username")
    h = {"Accept": "application/vnd.github+json", "User-Agent": "jarvis-mission"}
    days: dict[str, int] = {}
    with httpx.Client(timeout=10, headers=h) as c:
        r = c.get(f"https://api.github.com/users/{user}/events/public", params={"per_page": 100})
        if r.status_code == 404:
            raise ValueError("no such GitHub user")
        r.raise_for_status()
        for e in r.json():
            if e.get("type") != "PushEvent":
                continue
            d = str(e.get("created_at", ""))[:10]
            n = len((e.get("payload") or {}).get("commits") or []) or 1
            days[d] = days.get(d, 0) + n
        rr = c.get(f"https://api.github.com/users/{user}/repos", params={"sort": "updated", "per_page": 8})
        repos = [{"name": x["name"], "description": x.get("description"), "language": x.get("language"),
                  "stars": x.get("stargazers_count", 0), "updatedAt": x.get("pushed_at") or x.get("updated_at"),
                  "url": x.get("html_url"), "fork": x.get("fork", False)}
                 for x in (rr.json() if rr.status_code == 200 else [])]
    series = sorted(({"date": d, "count": n} for d, n in days.items()), key=lambda x: x["date"])
    last = series[-1]["date"] if series else None
    streak, cursor = 0, date.today()
    have = {x["date"] for x in series}
    if cursor.isoformat() not in have:
        cursor -= timedelta(days=1)                 # today not committed yet doesn't break the streak
    while cursor.isoformat() in have:
        streak += 1
        cursor -= timedelta(days=1)
    return {"user": user, "source": "public", "days": series, "total": sum(days.values()),
            "lastContribution": last, "currentStreak": streak, "repos": repos}


# ============================================================== arXiv
ATOM = {"a": "http://www.w3.org/2005/Atom"}


def arxiv(query: str, max_results: int = 6) -> list[dict]:
    q = re.sub(r"[^\w\s\-+]", " ", query)[:120]
    r = httpx.get("https://export.arxiv.org/api/query", timeout=15, params={
        "search_query": f"all:{q}", "start": 0, "max_results": max(1, min(max_results, 12)),
        "sortBy": "submittedDate", "sortOrder": "descending"})
    r.raise_for_status()
    # arXiv's Atom never declares a DOCTYPE or entities. Refusing any document that
    # does closes entity-expansion and external-entity tricks outright, on top of
    # the protections in the bundled expat, without adding a dependency.
    if re.search(r"<!(DOCTYPE|ENTITY)", r.text[:4096], re.I):
        raise ValueError("unexpected XML declarations in arXiv response")
    root = ET.fromstring(r.text)
    out = []
    for e in root.findall("a:entry", ATOM):
        link = next((l.get("href") for l in e.findall("a:link", ATOM) if l.get("type") == "text/html"), None)
        out.append({
            "id": (e.findtext("a:id", default="", namespaces=ATOM) or "").strip(),
            "title": " ".join((e.findtext("a:title", default="", namespaces=ATOM) or "").split()),
            "summary": " ".join((e.findtext("a:summary", default="", namespaces=ATOM) or "").split())[:400],
            "published": e.findtext("a:published", default="", namespaces=ATOM),
            "authors": [a.findtext("a:name", default="", namespaces=ATOM) for a in e.findall("a:author", ATOM)][:4],
            "url": link or (e.findtext("a:id", default="", namespaces=ATOM) or "").strip(),
        })
    return out


# ============================================================== focus guard
# On a phone, "leaving the app" was the distraction signal. On a laptop the work
# happens in OTHER apps (VS Code, KiCad, a PDF), so leaving JARVIS means nothing.
# The honest desktop signal is what's in front: a distraction in the foreground.
DISTRACTIONS = {
    "youtube": "YouTube", "instagram": "Instagram", "netflix": "Netflix", "prime video": "Prime Video",
    "reddit": "Reddit", "twitter": "X", " / x": "X", "facebook": "Facebook", "tiktok": "TikTok",
    "valorant": "Valorant", "steam": "Steam", "epic games": "Epic Games", "roblox": "Roblox",
    "riot client": "Riot", "cyberpunk": "Cyberpunk", "among us": "Among Us", "hotstar": "Hotstar",
    "whatsapp": "WhatsApp", "discord": "Discord", "snapchat": "Snapchat",
}
DISTRACTING_EXE = {"valorant.exe", "riotclientservices.exe", "steam.exe", "epicgameslauncher.exe",
                   "robloxplayerbeta.exe", "cyberpunk2077.exe", "among us.exe", "whatsapp.exe",
                   "discord.exe", "netflix.exe"}


def foreground() -> dict:
    """The window in front and whether it's a known distraction. Windows only."""
    try:
        import ctypes
        import ctypes.wintypes as wt
        import psutil
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        n = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        title = buf.value
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        try:
            exe = psutil.Process(pid.value).name()
        except Exception:
            exe = ""
    except Exception:
        return {"supported": False}
    t = title.lower()
    hit = next((name for key, name in DISTRACTIONS.items() if key in t), None)
    if hit is None and exe.lower() in DISTRACTING_EXE:
        hit = exe
    return {"supported": True, "title": title[:120], "exe": exe, "distraction": hit,
            "jarvis": title == "JARVIS"}


# ============================================================== calendar
def _unfold(text: str) -> list[str]:
    out: list[str] = []
    for line in text.splitlines():
        if line.startswith((" ", "\t")) and out:
            out[-1] += line[1:]
        else:
            out.append(line)
    return out


def _parse_dt(value: str, params: str) -> tuple[datetime, bool]:
    """(local naive datetime, all_day)."""
    if "VALUE=DATE" in params or re.fullmatch(r"\d{8}", value):
        return datetime.strptime(value[:8], "%Y%m%d"), True
    if value.endswith("Z"):
        dt = datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        return dt.astimezone().replace(tzinfo=None), False
    m = re.search(r"TZID=([^;:]+)", params)
    dt = datetime.strptime(value[:15], "%Y%m%dT%H%M%S")
    if m:
        try:
            from zoneinfo import ZoneInfo
            return dt.replace(tzinfo=ZoneInfo(m.group(1))).astimezone().replace(tzinfo=None), False
        except Exception:
            pass                                    # unknown zone / no tzdata: treat as local time
    return dt, False


WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


def _occurs_on(ev: dict, day: date) -> Optional[tuple[datetime, datetime]]:
    start, end = ev["start"], ev["end"]
    dur = end - start
    if day in ev.get("exdates", set()):
        return None
    rule = ev.get("rrule")
    if not rule:
        return (start, end) if start.date() <= day <= (end - timedelta(seconds=1)).date() or start.date() == day else None
    if day < start.date():
        return None
    parts = dict(p.split("=", 1) for p in rule.split(";") if "=" in p)
    freq, interval = parts.get("FREQ"), int(parts.get("INTERVAL", "1"))
    if "UNTIL" in parts:
        until, _ = _parse_dt(parts["UNTIL"], "")
        if day > until.date():
            return None
    delta = (day - start.date()).days
    if freq == "DAILY":
        ok = delta % interval == 0
    elif freq == "WEEKLY":
        byday = parts.get("BYDAY", WEEKDAYS[start.weekday()]).split(",")
        ok = WEEKDAYS[day.weekday()] in byday and (delta // 7) % interval == 0
    elif freq == "MONTHLY":
        ok = day.day == start.day
    elif freq == "YEARLY":
        ok = (day.month, day.day) == (start.month, start.day)
    else:
        ok = False
    if ok and "COUNT" in parts and freq == "DAILY":
        ok = delta // interval < int(parts["COUNT"])
    if not ok:
        return None
    s = datetime.combine(day, start.time())
    return s, s + dur


def parse_ics(text: str) -> list[dict]:
    events, cur = [], None
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            cur = {"exdates": set()}
        elif line == "END:VEVENT" and cur is not None:
            if "start" in cur:
                if "end" not in cur:
                    cur["end"] = cur["start"] + (timedelta(days=1) if cur.get("all_day") else timedelta(hours=1))
                events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            head, val = line.split(":", 1)
            name, _, params = head.partition(";")
            if name == "SUMMARY":
                cur["title"] = val.replace("\\,", ",").replace("\\n", " ")
            elif name == "DTSTART":
                cur["start"], cur["all_day"] = _parse_dt(val, params)
            elif name == "DTEND":
                cur["end"], _ = _parse_dt(val, params)
            elif name == "RRULE":
                cur["rrule"] = val
            elif name == "EXDATE":
                for v in val.split(","):
                    try:
                        cur["exdates"].add(_parse_dt(v, params)[0].date())
                    except ValueError:
                        pass
            elif name == "LOCATION":
                cur["location"] = val
    return events


class Calendar:
    def __init__(self, path: Path = CALENDAR):
        self.path = path
        self._cache: tuple[float, list[dict]] = (0.0, [])

    def _cfg(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return {"ics_url": None, "blocks": []}

    def _save(self, cfg: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

    def set_feed(self, url: Optional[str]) -> None:
        if url and not re.match(r"^https://[\w.-]+/", url):
            raise ValueError("the feed must be an https:// iCal address")
        cfg = self._cfg()
        cfg["ics_url"] = url or None
        self._save(cfg)
        self._cache = (0.0, [])

    def add_block(self, title: str, start_iso: str, minutes: int) -> dict:
        start = datetime.fromisoformat(start_iso)
        if not 15 <= minutes <= 480:
            raise ValueError("a block is 15 min to 8 h")
        b = {"id": f"blk_{int(time.time() * 1000)}", "title": (title or "Study block").strip()[:80],
             "start": start.isoformat(timespec="minutes"),
             "end": (start + timedelta(minutes=minutes)).isoformat(timespec="minutes")}
        cfg = self._cfg()
        cfg.setdefault("blocks", []).append(b)
        cfg["blocks"] = cfg["blocks"][-200:]
        self._save(cfg)
        return b

    def remove_block(self, block_id: str) -> None:
        cfg = self._cfg()
        cfg["blocks"] = [b for b in cfg.get("blocks", []) if b["id"] != block_id]
        self._save(cfg)

    def block_ics(self, block_id: str) -> str:
        b = next((x for x in self._cfg().get("blocks", []) if x["id"] == block_id), None)
        if b is None:
            raise KeyError(block_id)
        fmt = lambda s: datetime.fromisoformat(s).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        return "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//JARVIS//Mission//EN",
                            "BEGIN:VEVENT", f"UID:{b['id']}@jarvis", f"DTSTAMP:{fmt(b['start'])}",
                            f"DTSTART:{fmt(b['start'])}", f"DTEND:{fmt(b['end'])}",
                            f"SUMMARY:{b['title']}", "END:VEVENT", "END:VCALENDAR", ""])

    def _feed_events(self) -> list[dict]:
        url = self._cfg().get("ics_url")
        if not url:
            return []
        if time.time() - self._cache[0] < 300:
            return self._cache[1]
        r = httpx.get(url, timeout=15, follow_redirects=True)
        r.raise_for_status()
        events = parse_ics(r.text)
        self._cache = (time.time(), events)
        return events

    def today(self, day: Optional[date] = None) -> dict:
        day = day or date.today()
        cfg = self._cfg()
        err, events = None, []
        try:
            for ev in self._feed_events():
                occ = _occurs_on(ev, day)
                if occ:
                    events.append({"title": ev.get("title", "(busy)"), "start": occ[0].isoformat(timespec="minutes"),
                                   "end": occ[1].isoformat(timespec="minutes"), "allDay": ev.get("all_day", False),
                                   "location": ev.get("location"), "source": "calendar"})
        except Exception as e:
            err = f"couldn't read the calendar feed: {e}"
        for b in cfg.get("blocks", []):
            if datetime.fromisoformat(b["start"]).date() == day:
                events.append({**b, "allDay": False, "source": "jarvis"})
        events.sort(key=lambda e: e["start"])
        return {"date": day.isoformat(), "feed": bool(cfg.get("ics_url")), "error": err,
                "events": events, "free": free_blocks(events, day)}


def free_blocks(events: list[dict], day: date, start_h: int = 8, end_h: int = 23, min_gap: int = 30) -> list[dict]:
    """Gaps >= min_gap minutes between timed events — Germoney's freeBlocks(), ported."""
    lo = datetime.combine(day, datetime.min.time()) + timedelta(hours=start_h)
    hi = datetime.combine(day, datetime.min.time()) + timedelta(hours=end_h)
    wins = sorted((max(datetime.fromisoformat(e["start"]), lo), min(datetime.fromisoformat(e["end"]), hi))
                  for e in events if not e.get("allDay"))
    out, cursor = [], lo
    for s, e in wins:
        if e <= lo or s >= hi:
            continue
        if (s - cursor).total_seconds() >= min_gap * 60:
            out.append({"start": cursor.isoformat(timespec="minutes"), "end": s.isoformat(timespec="minutes"),
                        "minutes": int((s - cursor).total_seconds() // 60)})
        cursor = max(cursor, e)
    if (hi - cursor).total_seconds() >= min_gap * 60:
        out.append({"start": cursor.isoformat(timespec="minutes"), "end": hi.isoformat(timespec="minutes"),
                    "minutes": int((hi - cursor).total_seconds() // 60)})
    return out


# ============================================================== the plan engine
# Mission Germoney v2: the game's work comes from a skill tree, not from a fixed
# pool of strings. The bank (JSON, written by research agents) says WHAT exists:
# nodes, their prerequisites, resources, certificates, contracts with context. The
# state below says where Aman is. Everything voice needs is computed here, in the
# server, so "what's today's contract" works with the window closed.
#
# Design reasons: docs/design/mission-game.md ("v2: the tree").

BANK_DIR = Path(__file__).resolve().parents[1] / "ui" / "src" / "germoney" / "data" / "bank"
ACADEMICS = ROOT / "academics" / "academics.json"
ACADEMICS_OVERRIDES = ROOT / "academics" / "overrides.json"
FINDINGS = ROOT / "findings.json"
PLAN_KEY = "@mission_v2"
PLAYER_KEY = "@silicon_player_v2"
WIP_CAP = 3                     # nodes in progress at once, and campaigns at once
EXAM_WINDOW = 14                # days before an exam when exam mode starts
BANK_FILES = ("skilltree.json", "certs.json", "resources-career.json", "resources-academic.json", "math-track.json")


def bank_dir() -> Path:
    import os
    return Path(os.environ.get("JARVIS_MISSION_BANK") or BANK_DIR)


def _as_list(v: Any) -> list:
    return v if isinstance(v, list) else []


def _str_list(v: Any) -> list[str]:
    if isinstance(v, str):                          # "covers": "Boolean algebra, K-maps" is a list of one
        return [v] if v.strip() else []
    return [str(x) for x in _as_list(v) if isinstance(x, (str, int, float))]


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _clean_contract(c: Any, node_id: str, i: int, warn: list[str]) -> Optional[dict]:
    if not isinstance(c, dict) or not c.get("title"):
        warn.append(f"node {node_id}: contract #{i + 1} has no title, skipped")
        return None
    cid = str(c.get("id") or f"c{i + 1}")
    if not c.get("id"):
        warn.append(f"node {node_id}: contract '{c['title']}' has no id, using {cid}")
    try:
        minutes = max(5, min(240, int(c.get("minutes") or 30)))
        xp = max(0, min(200, int(c.get("xp") or 20)))
    except (TypeError, ValueError):
        minutes, xp = 30, 20
    return {"id": cid, "title": str(c["title"]), "minutes": minutes, "context": str(c.get("context") or ""),
            "steps": _str_list(c.get("steps")), "hint": str(c.get("hint") or ""),
            "success_check": str(c.get("success_check") or ""), "xp": xp}


def _clean_node(n: Any, default_branch: Optional[str], warn: list[str]) -> Optional[dict]:
    if not isinstance(n, dict) or not n.get("id") or not n.get("name"):
        warn.append("a node without id or name was skipped")
        return None
    nid = str(n["id"])
    proj = n.get("project")
    project = None
    if isinstance(proj, dict) and proj.get("title"):
        project = {"title": str(proj["title"]), "deliverable": str(proj.get("deliverable") or ""),
                   "linkedin_line": str(proj.get("linkedin_line") or "")}
    try:
        tier = max(0, int(n.get("tier") or 0))
        hours = max(0.0, float(n.get("hours_est") or 0))
    except (TypeError, ValueError):
        tier, hours = 0, 0.0
    maths: dict[str, float] = {}                     # skill tree v2: how much of each maths node this needs, 0..1
    for k, v in (n.get("maths") if isinstance(n.get("maths"), dict) else {}).items():
        w = _num(v)
        if w is None:
            warn.append(f"node {nid}: maths weight for {k} is not a number")
        elif w > 0:
            maths[str(k)] = max(0.0, min(1.0, w))
    contracts = [x for i, c in enumerate(_as_list(n.get("contracts"))) if (x := _clean_contract(c, nid, i, warn))]
    seen: set[str] = set()
    for c in contracts:                              # contract ids must be unique inside a node
        if c["id"] in seen:
            c["id"] = f"{c['id']}-{len(seen)}"
        seen.add(c["id"])
    return {"id": nid, "name": str(n["name"]), "branch": str(n.get("branch") or default_branch or "general"),
            "tier": tier, "prereqs": _str_list(n.get("prereqs")), "outcomes": _str_list(n.get("outcomes")),
            "hours_est": hours, "resources": _str_list(n.get("resources")), "certs": _str_list(n.get("certs")),
            "project": project, "contracts": contracts, "maths": maths}


def find_cycles(nodes: dict[str, dict]) -> list[list[str]]:
    """Every prerequisite cycle (as a list of ids), by iterative DFS colouring."""
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {k: WHITE for k in nodes}
    cycles: list[list[str]] = []
    for root in nodes:
        if colour[root] != WHITE:
            continue
        path: list[str] = []
        stack: list[tuple[str, int]] = [(root, 0)]
        while stack:
            u, i = stack.pop()
            if i == 0:
                colour[u] = GREY
                path.append(u)
            pre = [p for p in nodes[u]["prereqs"] if p in nodes]
            if i < len(pre):
                stack.append((u, i + 1))
                v = pre[i]
                if colour[v] == GREY:
                    cycles.append(path[path.index(v):] + [v])
                elif colour[v] == WHITE:
                    stack.append((v, 0))
            else:
                colour[u] = BLACK
                path.pop()
    return cycles


def merge_bank(files: dict[str, Any]) -> dict:
    """Merge whatever bank files exist into one bank. Unknown ids are warnings (the
    reference is dropped, so a typo never locks a node forever); a prerequisite
    cycle is an error. `files` maps a file name to its parsed JSON."""
    warn: list[str] = []
    err: list[str] = []
    nodes: dict[str, dict] = {}
    order: list[str] = []
    resources: dict[str, dict] = {}
    certs: dict[str, dict] = {}
    careers: list[dict] = []
    math: dict = {"diagnostic": [], "practice_engine": {}}
    version = None

    def add_nodes(raw: Any, default_branch: Optional[str], src: str) -> None:
        for n in _as_list(raw):
            node = _clean_node(n, default_branch, warn)
            if not node:
                continue
            if node["id"] in nodes:
                warn.append(f"{src}: duplicate node id {node['id']}, the first one wins")
                continue
            nodes[node["id"]] = node
            order.append(node["id"])

    def add_resources(raw: Any, src: str) -> None:
        for r in _as_list(raw):
            if not isinstance(r, dict) or not r.get("id") or not r.get("url"):
                warn.append(f"{src}: a resource without id or url was skipped")
                continue
            rid = str(r["id"])
            if rid in resources:
                warn.append(f"{src}: duplicate resource id {rid}, the first one wins")
                continue
            resources[rid] = {"id": rid, "title": str(r.get("title") or rid), "kind": str(r.get("kind") or "link"),
                              "url": str(r["url"]), "free": bool(r.get("free", True)),
                              "legal_pdf_url": r.get("legal_pdf_url") or None,
                              "certificate": r.get("certificate") if isinstance(r.get("certificate"), (str, dict)) and r.get("certificate") else None,
                              "covers": _str_list(r.get("covers")), "skip_topics": _str_list(r.get("skip_topics")),
                              "hours": _num(r.get("hours"))}

    tree = files.get("skilltree.json")
    if tree is not None:
        if not isinstance(tree, dict):
            err.append("skilltree.json: expected an object {version, careers, nodes}")
        else:
            version = tree.get("version")
            for c in _as_list(tree.get("careers")):
                if isinstance(c, dict) and c.get("id"):
                    w = c.get("weights") if isinstance(c.get("weights"), dict) else {}
                    weights = {}
                    for k, v in w.items():
                        if _num(v) is None:
                            warn.append(f"career {c['id']}: weight for {k} is not a number")
                            continue
                        weights[str(k)] = max(0.0, min(1.0, float(v)))
                    careers.append({"id": str(c["id"]), "name": str(c.get("name") or c["id"]),
                                    "summary": str(c.get("summary") or ""), "weights": weights})
            add_nodes(tree.get("nodes"), None, "skilltree.json")
    mt = files.get("math-track.json")
    if mt is not None:
        if not isinstance(mt, dict):
            err.append("math-track.json: expected an object {version, diagnostic, nodes, resources, practice_engine}")
        else:
            add_nodes(mt.get("nodes"), "math", "math-track.json")
            add_resources(mt.get("resources"), "math-track.json")
            math = {"diagnostic": _as_list(mt.get("diagnostic")),
                    "practice_engine": mt.get("practice_engine") if isinstance(mt.get("practice_engine"), dict) else {}}
    for name in ("resources-career.json", "resources-academic.json"):
        if files.get(name) is not None:
            if not isinstance(files[name], list):
                err.append(f"{name}: expected a list of resources")
            else:
                add_resources(files[name], name)
    cf = files.get("certs.json")
    if cf is not None:
        if not isinstance(cf, list):
            err.append("certs.json: expected a list of certificates")
        else:
            for c in cf:
                if not isinstance(c, dict) or not c.get("id") or not c.get("name"):
                    warn.append("certs.json: a certificate without id or name was skipped")
                    continue
                certs[str(c["id"])] = {
                    "id": str(c["id"]), "name": str(c["name"]), "issuer": str(c.get("issuer") or ""),
                    "cost_inr": _num(c.get("cost_inr")), "free_option": c.get("free_option") or None,
                    "time_hours": _num(c.get("time_hours")),
                    "credibility": c.get("credibility") if isinstance(c.get("credibility"), (int, float, str)) else "",
                    "credibility_by_career": c.get("credibility_by_career") if isinstance(c.get("credibility_by_career"), dict) else {},
                    "linkedin_worthy": bool(c.get("linkedin_worthy")), "node_ids": _str_list(c.get("node_ids")),
                    "url": c.get("url") or None, "notes": str(c.get("notes") or ""), "price_status": str(c.get("price_status") or "")}

    # ---- cross references: warn and drop, never crash
    resolved: set[str] = set()
    for n in nodes.values():
        for p in [p for p in n["prereqs"] if p not in nodes]:
            warn.append(f"node {n['id']}: unknown prerequisite {p} (ignored)")
        n["prereqs"] = [p for p in n["prereqs"] if p in nodes and p != n["id"]]
        for k in [k for k in n["maths"] if k not in nodes]:
            warn.append(f"node {n['id']}: unknown maths node {k} (ignored)")
            del n["maths"][k]
        for r in [r for r in n["resources"] if r not in resources]:
            warn.append(f"node {n['id']}: unknown resource {r}")
        n["resources"] = [r for r in n["resources"] if r in resources]
        if cf is not None:
            for c in [c for c in n["certs"] if c not in certs]:
                r = resources.get(c)
                if r and r.get("certificate"):
                    cert = r["certificate"]
                    if isinstance(cert, str) and cert in certs:
                        n["certs"] = [cert if x == c else x for x in n["certs"]]
                        continue
                    if c not in certs:                 # the resource's own certificate details
                        info = cert if isinstance(cert, dict) else {}
                        certs[c] = {"id": c, "name": f"Certificate: {r['title']}", "issuer": str(info.get("provider") or ""),
                                    "cost_inr": _num(info.get("exam_fee_inr")), "free_option": str(info.get("note") or "") or None,
                                    "time_hours": r.get("hours"), "credibility": "", "credibility_by_career": {},
                                    "linkedin_worthy": True, "node_ids": [], "url": r["url"], "notes": "from the resource's certificate field",
                                    "price_status": "", "from_resource": True}
                        resolved.add(c)
                    continue
                warn.append(f"node {n['id']}: unknown certificate {c}")
            n["certs"] = [c for c in n["certs"] if c in certs]
    for c in sorted(resolved):
        warn.append(f"certificate id {c} is a resource, not in certs.json: used the resource's certificate details")
    for nid, n in nodes.items():
        for c in n["certs"]:
            if certs.get(c, {}).get("from_resource") and nid not in certs[c]["node_ids"]:
                certs[c]["node_ids"].append(nid)
    for c in certs.values():
        for nid in [x for x in c["node_ids"] if x not in nodes]:
            warn.append(f"certificate {c['id']}: unknown node {nid}")
        c["node_ids"] = [x for x in c["node_ids"] if x in nodes]
        for nid in c["node_ids"]:                    # the link works both ways
            if c["id"] not in nodes[nid]["certs"]:
                nodes[nid]["certs"].append(c["id"])
    for car in careers:
        for k in [k for k in car["weights"] if k not in nodes]:
            warn.append(f"career {car['id']}: unknown node {k}")
            car["weights"].pop(k)
    for cyc in find_cycles(nodes):
        err.append("prerequisite cycle: " + " -> ".join(cyc))
    index = {}
    for nid in order:
        for c in nodes[nid]["contracts"]:
            index.setdefault(c["id"], nid)
    return {"version": version, "careers": careers, "nodes": nodes, "order": order, "resources": resources,
            "certs": certs, "math": math, "contract_index": index, "warnings": warn, "errors": err, "files": sorted(files)}


_bank_cache: dict[str, Any] = {"key": None, "bank": None}


def load_bank(directory: Optional[Path] = None) -> dict:
    """Read every bank file that exists (any subset), merged and validated. Cached
    by file mtimes, so files landing while the app runs are picked up."""
    d = directory or bank_dir()
    stamp = []
    for name in BANK_FILES:
        p = d / name
        if p.exists():
            stamp.append((name, p.stat().st_mtime_ns, p.stat().st_size))
    key = (str(d), tuple(stamp))
    if _bank_cache["key"] == key:
        return _bank_cache["bank"]
    files: dict[str, Any] = {}
    errs: list[str] = []
    for name, _, _ in stamp:
        try:
            files[name] = json.loads((d / name).read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            errs.append(f"{name}: not valid JSON ({e})")
    bank = merge_bank(files)
    bank["errors"] = errs + bank["errors"]
    _bank_cache.update(key=key, bank=bank)
    return bank


# ------------------------------------------------------------------ academics (private)
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WEIGHT_WORDS = {"high": 0.4, "med": 0.25, "medium": 0.25, "low": 0.1}
CALENDAR_KEYS = ("internals_start", "end_sem_start", "backlog_block_start")


def _date_or_none(v: Any) -> Optional[str]:
    # Decision (test audit 2026-10-23): the shape alone let "2026-02-30" through, and
    # every later date.fromisoformat() then raised inside today(). An impossible date
    # is treated like "TBC": no date, never a guessed one.
    if not (isinstance(v, str) and _DATE.match(v)):
        return None
    try:
        date.fromisoformat(v)
    except ValueError:
        return None
    return v


def _weight(v: Any) -> float:
    if isinstance(v, str):
        return WEIGHT_WORDS.get(v.strip().lower(), 0.2)
    return max(0.0, min(1.0, _num(v) or 0.0))


def load_academics(path: Optional[Path] = None, overrides: Optional[Path] = None, rescue: Optional[Path] = None) -> Optional[dict]:
    """academics.json (written by others, private, never bundled) + math-rescue.json
    + the dates he set here (overrides.json), normalised.

    Real-world shape (2026-10): a calendar (internals_start, end_sem_start, a backlog
    block whose dates are TBC), subjects whose dates come from that calendar
    (internal_from / end_sem_from) rather than one exam_date, unit weights as
    words (high / med / low), and a plan of phases (plan.by_days_left) that says
    what each library day holds."""
    path = path or ACADEMICS
    overrides = overrides or path.parent / "overrides.json"
    rescue = rescue or path.parent / "math-rescue.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except ValueError as e:
        return {"semester": None, "subjects": [], "plan": {}, "calendar": {}, "rescue": None, "unresolved": [],
                "error": f"academics.json is not valid JSON ({e})"}
    if not isinstance(raw, dict):
        raw = {}
    try:
        ov = json.loads(overrides.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        ov = {}
    cal_raw = raw.get("calendar") if isinstance(raw.get("calendar"), dict) else {}
    bb = cal_raw.get("backlog_block") if isinstance(cal_raw.get("backlog_block"), dict) else {}
    cal_ov = ov.get("calendar") or {}
    calendar = {"internals_start": _date_or_none(cal_ov.get("internals_start")) or _date_or_none(cal_raw.get("internals_start")),
                "end_sem_start": _date_or_none(cal_ov.get("end_sem_start")) or _date_or_none(cal_raw.get("end_sem_start")),
                "end_sem_approx": bool(cal_raw.get("end_sem_start_approx")) and not cal_ov.get("end_sem_start"),
                "backlog_block_start": _date_or_none(cal_ov.get("backlog_block_start")) or _date_or_none(bb.get("start")),
                "backlog_days": int(_num(bb.get("days")) or 3), "backlog_status": str(bb.get("status") or ""),
                "set_here": sorted(k for k in CALENDAR_KEYS if cal_ov.get(k))}
    subjects = []
    for s in _as_list(raw.get("subjects")):
        if not isinstance(s, dict) or not s.get("id"):
            continue
        sid = str(s["id"])
        units = []
        for i, u in enumerate(_as_list(s.get("units"))):
            if not isinstance(u, dict):
                continue
            n = u.get("n", i + 1)
            res = _as_list(u.get("resources"))
            units.append({"n": n, "title": str(u.get("title") or f"Unit {n}"), "topics": _str_list(u.get("topics")),
                          "exam_weight": _weight(u.get("exam_weight")), "weight_label": str(u.get("exam_weight") or ""),
                          "skip_if_short": bool(u.get("skip_if_short")),
                          "resources": [str(x) for x in res if isinstance(x, str)],
                          "files": [f for f in (_clean_file(x) for x in res if isinstance(x, dict)) if f],
                          "pyq_refs": _str_list(u.get("pyq_refs")), "must_do": _str_list(u.get("must_do"))})
        kind = "backlog" if s.get("kind") == "backlog" else "current"
        mine = (ov.get("exam_dates") or {}).get(sid)
        qb = []
        for i, q in enumerate(_as_list(s.get("question_bank"))):
            if not isinstance(q, dict) or not q.get("question"):
                continue
            try:
                unit = int(q.get("unit")) if q.get("unit") is not None else None
            except (TypeError, ValueError):
                unit = None
            sitting = str(q.get("sitting") or "")
            qid = f"{sid}:{re.sub(r'[^A-Za-z0-9]+', '-', sitting).strip('-') or 'q'}:{q.get('choice_group') or ''}"
            qb.append({"id": qid, "unit": unit, "topic": str(q.get("topic") or ""), "question": str(q["question"]),
                       "marks": _num(q.get("marks")), "type": str(q.get("type") or ""), "section": str(q.get("section") or ""),
                       "choice_group": str(q.get("choice_group") or ""), "sitting": sitting,
                       "file": _clean_file({"local_path": q.get("source_file"), "title": sitting or "past paper"})})
        # Decision (test audit): a question's id must name that one question, and must
        # not move when the file is reordered. The real papers use choice groups like
        # "2 (OR)" for BOTH alternatives, so sitting + group made two questions one id:
        # doing one ticked off the other unseen. Unique "sitting:group" ids stay as they
        # were; a missing group or a shared one gets a hash of the question text
        # (the old fallback was the list index, which shifted on every rewrite).
        counts: dict[str, int] = {}
        for q in qb:
            counts[q["id"]] = counts.get(q["id"], 0) + 1
        for q in qb:
            if not q["choice_group"] or counts[q["id"]] > 1:
                h = hashlib.sha1(" ".join(q["question"].lower().split()).encode("utf-8")).hexdigest()[:8]
                q["id"] = f"{q['id'].rstrip(':')}:{h}" if q["choice_group"] else f"{q['id']}{h}"
        subjects.append({
            "id": sid, "name": str(s.get("name") or sid), "code": str(s.get("code") or ""), "kind": kind, "units": units,
            "strategy": str(s.get("strategy") or ""), "risk": str(s.get("risk") or ""),
            "dates": {"set_here": _date_or_none(mine), "exam": _date_or_none(s.get("exam_date")),
                      "internals": _date_or_none(s.get("internal_from")) or (calendar["internals_start"] if kind == "current" and s.get("internal_from") is not None else None),
                      "end_sem": _date_or_none(s.get("end_sem_from")),
                      "end_sem_approx": bool(s.get("end_sem_approx")),
                      "backlog": calendar["backlog_block_start"] if kind == "backlog" else None},
            "date_set_here": bool(_date_or_none(mine)),
            "question_bank": qb, "paper_pattern": s.get("paper_pattern") if isinstance(s.get("paper_pattern"), dict) else None,
            "pass_rule": pass_needs(s.get("pass_rule"))})
    plan = raw.get("plan") if isinstance(raw.get("plan"), dict) else {}
    try:
        rr = json.loads(rescue.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        rr = None
    resc = None
    if isinstance(rr, dict) and isinstance(rr.get("exam_rescue"), dict):
        er = rr["exam_rescue"]
        target = str(er.get("target") or "")
        norm = lambda x: re.sub(r"[^a-z0-9]", "", x.lower())
        subj = next((x for x in subjects if x["code"] and norm(x["code"]) in norm(target)), None) or \
            next((x for x in subjects if x["kind"] == "backlog" and "math" in x["id"].lower()), None)
        resc = {"subject": subj["id"] if subj else None, "target": target, "window": str(er.get("window") or ""),
                "triage": [t for t in _as_list(er.get("triage")) if isinstance(t, dict)],
                "foundation_feed": er.get("foundation_feed") if isinstance(er.get("foundation_feed"), dict) else {},
                "week_plan": [w for w in _as_list(er.get("week_plan")) if isinstance(w, dict)],
                "exam_day_rules": _str_list(er.get("exam_day_rules")),
                "honest_timeline": rr.get("honest_timeline") if isinstance(rr.get("honest_timeline"), str) else ""}
    out = {"semester": raw.get("semester"), "calendar": calendar, "subjects": subjects, "plan": plan, "rescue": resc,
           "unresolved": _str_list(raw.get("unresolved"))}
    for s in subjects:                              # legacy single-date view (fixtures, older files)
        s["exam_date"] = next_exam(out, s, date.today().isoformat())[0]
    return out


def _clean_file(x: Any) -> Optional[dict]:
    """A local study file (faculty notes, a real past paper): served by the file route,
    which only allows the academics folder and the OneDrive COLLEGE folder."""
    if not isinstance(x, dict) or not isinstance(x.get("local_path"), str) or not x["local_path"].strip():
        return None
    path = x["local_path"].strip()
    return {"title": str(x.get("title") or Path(path).name)[:160], "path": path, "pages": str(x.get("pages") or "") or None,
            "role": str(x.get("role") or ""), "kind": str(x.get("kind") or ""), "allowed": file_allowed(path) is not None}


COLLEGE = Path.home() / "OneDrive" / "Documents" / "COLLEGE"
FILE_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".txt", ".md"}


def file_roots() -> list[Path]:
    return [ACADEMICS.parent, COLLEGE]


def file_allowed(path: str) -> Optional[Path]:
    """The real path of a study file, only if it is a file inside an allowed root with
    an allowed extension; None otherwise (no traversal, no symlink escapes)."""
    try:
        real = Path(path).resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        return None
    if not real.is_file() or real.suffix.lower() not in FILE_EXTS:
        return None
    for root in file_roots():
        try:
            real.relative_to(root.resolve())
            return real
        except (ValueError, OSError):
            continue
    return None


def pass_needs(rule: Any) -> Optional[dict]:
    """The pass rule (SEE >= x of y, CIE >= ..., aggregate >= z %) and, with the
    internal marks carried over, the SEE marks needed to pass."""
    if not isinstance(rule, dict):
        return None
    see_min, see_max = _num(rule.get("see_min")), _num(rule.get("see_max"))
    cie_max, agg = _num(rule.get("cie_max")), _num(rule.get("aggregate_min_pct"))
    ia = _num(rule.get("ia_carried_over"))
    cie_min = _num(rule.get("cie_min"))
    needed = None
    if ia is not None and see_max and cie_max and agg is not None:
        import math
        from fractions import Fraction
        # Decision (test audit): exact arithmetic. agg / 100 * total in floats made
        # 55 % of 100 come out as 55.000000000000007, one mark too many after ceil().
        total = Fraction(str(agg)) * (Fraction(str(see_max)) + Fraction(str(cie_max))) / 100
        needed = int(max(see_min or 0, math.ceil(total - Fraction(str(ia)))))
    elif see_min is not None:
        needed = int(see_min)
    out = {**{k: v for k, v in rule.items() if isinstance(v, (int, float, str, list))}, "see_needed_computed": needed}
    # Honest limits: carried-over IA below the CIE minimum, or a SEE target above the
    # paper's maximum, means the SEE alone cannot pass it; say so instead of a number.
    out["cie_ok"] = None if ia is None or cie_min is None else ia >= cie_min
    out["possible"] = None if needed is None or not see_max else (needed <= see_max and out["cie_ok"] is not False)
    return out


def next_exam(ac: dict, s: dict, today: str) -> tuple[Optional[str], str, bool]:
    """The next exam date for a subject, what kind it is, and whether it is approximate.
    A date he set wins; internals before end-sem; a backlog block with no date yet
    has none (the voice says so, rather than inventing one)."""
    d = s.get("dates") or {}
    if d.get("set_here") and d["set_here"] >= today:
        return d["set_here"], "set by you", False
    if d.get("exam") and d["exam"] >= today:
        return d["exam"], "exam", False
    if s["kind"] == "backlog":
        return (d["backlog"], "backlog block", False) if d.get("backlog") and d["backlog"] >= today else (None, "backlog block (date to confirm)", True)
    if d.get("internals") and d["internals"] >= today:
        return d["internals"], "internals", False
    if d.get("end_sem") and d["end_sem"] >= today:
        return d["end_sem"], "end-sem", bool(d.get("end_sem_approx"))
    return None, "no date", True


def _write_overrides(overrides: Path, fn) -> None:
    try:
        ov = json.loads(overrides.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        ov = {}
    fn(ov)
    overrides.parent.mkdir(parents=True, exist_ok=True)
    tmp = overrides.with_suffix(".tmp")
    tmp.write_text(json.dumps(ov, indent=1), encoding="utf-8")
    tmp.replace(overrides)


def set_exam_date(subject: str, day: Optional[str], path: Optional[Path] = None, overrides: Optional[Path] = None) -> dict:
    """Exam dates change (internal timetable, end-sem, backlog days TBC): they are set
    here, in overrides.json next to academics.json, so a rewrite of that file by its
    author never loses the dates he typed. `subject` may also be calendar:<key> for
    internals_start, end_sem_start or backlog_block_start."""
    path = path or ACADEMICS
    overrides = overrides or path.parent / "overrides.json"
    ac = load_academics(path, overrides)
    if ac is None:
        raise KeyError("academics.json is not there yet")
    if day is not None and not _DATE.match(day):
        raise ValueError("date must be YYYY-MM-DD")
    if subject.startswith("calendar:"):
        key = subject.split(":", 1)[1]
        if key not in CALENDAR_KEYS:
            raise KeyError(f"no calendar date {key}")
        _write_overrides(overrides, lambda ov: ov.setdefault("calendar", {}).__setitem__(key, day))
    else:
        if subject not in {s["id"] for s in ac["subjects"]}:
            raise KeyError(f"no subject {subject}")
        _write_overrides(overrides, lambda ov: ov.setdefault("exam_dates", {}).__setitem__(subject, day))
    return load_academics(path, overrides)


def plan_for_days(plan: dict, days_left: int) -> Optional[str]:
    """Advice from plan.by_days_left when it is the simple {"7": "..."} form."""
    table = plan.get("by_days_left") if isinstance(plan, dict) else None
    if not isinstance(table, dict):
        return None
    best = None
    for k, v in table.items():
        try:
            t = int(k)
        except ValueError:
            continue
        if days_left <= t and (best is None or t < best[0]):
            best = (t, v)
    if best is None:
        return None
    v = best[1]
    return " ".join(map(str, v)) if isinstance(v, list) else str(v)


WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _anchor_date(ac: dict, phase: dict, today: str) -> Optional[str]:
    cal = ac.get("calendar") or {}
    a = str(phase.get("anchor") or "")
    if a == "internals_start":
        return cal.get("internals_start") or _date_or_none(phase.get("anchor_date"))
    if a == "end_sem_start":
        return cal.get("end_sem_start") or _date_or_none(phase.get("anchor_date"))
    if a.startswith("backlog_block_start"):
        return cal.get("backlog_block_start") or (cal.get("end_sem_start") if "end_sem" in a else None) or _date_or_none(phase.get("anchor_date"))
    if a == "each_paper":                        # the exam window: end-sem and backlog papers, not internals
        dates = [d for s in ac["subjects"] for d, k, _ in [next_exam(ac, s, today)] if d and k != "internals"]
        return min(dates) if dates else None
    return _date_or_none(phase.get("anchor_date"))


def papers_ahead(ac: dict, today: str) -> bool:
    """Is any paper still to come: a dated exam today or later, or a re-sit whose date
    was never given (TBC: it is still ahead, we just don't know when)?"""
    for s in ac["subjects"]:
        if next_exam(ac, s, today)[0]:
            return True
        d = s.get("dates") or {}
        if s["kind"] == "backlog" and not any(d.get(k) for k in ("set_here", "exam", "backlog")):
            return True
    return False


def active_phase(ac: dict, today: str) -> Optional[dict]:
    """The plan phase today falls in (plan.by_days_left as a list of phases). Later
    phases win where two overlap (an open-ended "internals week" gives way to the
    backlog build)."""
    phases = (ac.get("plan") or {}).get("by_days_left")
    if not isinstance(phases, list):
        return None
    hit = None
    for i, ph in enumerate(phases):
        if not isinstance(ph, dict):
            continue
        anchor = _anchor_date(ac, ph, today)
        if not anchor:
            continue
        left = (_day(anchor) - _day(today)).days
        hi = _num(ph.get("days_left_from"))
        lo = _num(ph.get("days_left_to"))
        if (hi is None or left <= hi) and (lo is None or left >= lo) and (hi is not None or lo is not None):
            if lo is None and left < -45:          # an open-ended phase does not last forever
                continue
            # Decision (test audit, 90-day run): an open-ended phase ("internals week")
            # also ends when no paper is left: no dated exam ahead and no re-sit still
            # waiting for its date. It used to run on for 45 days, prepping papers
            # already written and scheduling "next-internal-paper" with none left.
            if lo is None and not papers_ahead(ac, today):
                continue
            # Honesty (test audit): a backlog phase anchored on the end-sem date while
            # the backlog block is TBC, or on an approximate end-sem date, counts down
            # to an assumed day. Label it, so the voice never states it as fact.
            cal = ac.get("calendar") or {}
            a = str(ph.get("anchor") or "")
            assumed = (a.startswith("backlog_block_start") and not cal.get("backlog_block_start")) or \
                ("end_sem" in a and anchor == cal.get("end_sem_start") and bool(cal.get("end_sem_approx")))
            hit = {"index": i, "phase": ph, "anchor": anchor, "days_left": left, "assumed": assumed}
    return hit


def phase_blocks(ph: dict, today: str) -> list[dict]:
    """Today's [subject, minutes, note] blocks from a phase: the exact day, else the
    weekday template, else the phase template."""
    p = ph["phase"]
    rows = None
    for d in _as_list(p.get("days")):
        if isinstance(d, dict) and _num(d.get("days_left")) == ph["days_left"]:
            rows = d.get("blocks")
            break
    if rows is None and isinstance(p.get("weekly_template"), dict):
        rows = p["weekly_template"].get(WEEKDAY_KEYS[_day(today).weekday()])
    if rows is None:
        rows = p.get("template")
    out = []
    for r in _as_list(rows):
        if isinstance(r, list) and r and isinstance(r[0], str):
            out.append({"subject": r[0], "minutes": int(_num(r[1]) or 60) if len(r) > 1 else 60, "note": str(r[2]) if len(r) > 2 else ""})
    return out


# ------------------------------------------------------------------ state
DEFAULT_ROTATION = {
    # ISO weekday (Mon=1). Five library days, each a different track: variety is
    # the point. He starts open-ended work easily and tires of routine.
    "1": {"track": "digital", "label": "Digital logic & HDL", "match": ["digital", "logic", "hdl", "verilog", "rtl", "vlsi", "fpga", "verification", "implementation", "analog", "devices"]},
    "2": {"track": "math", "label": "Maths", "match": ["math"]},
    "3": {"track": "ml", "label": "ML / DL", "match": ["ml", "deep_learning", "machine", "deep", "learning"]},
    "4": {"track": "academics", "label": "Academics & exams", "match": []},
    "5": {"track": "arch", "label": "Comp-arch / RISC-V · security", "match": ["arch", "risc", "cpu", "ai_hardware", "security", "crypto", "embedded"]},
}
DEFAULT_SCHEDULE = {
    "library": {"start": "10:00", "minutes": 180},
    "evening": {"start": "19:30", "minutes": 60},
    "protected": {"start": "17:30", "minutes": 90, "label": "Social · rest (never filled)"},
    "weekend": {"start": "11:00", "minutes": 60},
}
DEFAULT_BUDGET = {"cert_inr_month": 3000, "cert_stretch_inr": 5000}


def default_plan_state(today: str) -> dict:
    return {"v": 2, "created": today, "xp": 0, "xp_migrated_from": None, "career": None, "nodes": {}, "contracts": {},
            "events": [], "days": {}, "rotation": json.loads(json.dumps(DEFAULT_ROTATION)),
            "schedule": json.loads(json.dumps(DEFAULT_SCHEDULE)), "resume": {}, "campaigns": {}, "parking": [],
            "exam": {"focus": None, "window_days": EXAM_WINDOW}, "cursor": None, "wip_cap": WIP_CAP, "seq": 0,
            "budget": dict(DEFAULT_BUDGET), "certs": {}, "questions_done": [], "nudged_drift": None,
            "quests": {}, "archive": wellwisher.empty_archive(),
            "money": {"entries": [], "seq": 0}}                # the money log (Well Wisher money engine)


def merge_plan_state(raw: Any, today: str) -> dict:
    d = default_plan_state(today)
    if not isinstance(raw, dict):
        return d
    out = dict(d)
    for k, v in raw.items():
        if k in d and (d[k] is None or type(v) is type(d[k])):
            out[k] = v
    for k in ("rotation", "schedule", "exam", "budget"):
        out[k] = {**d[k], **(raw.get(k) if isinstance(raw.get(k), dict) else {})}
    return out


def level_info(xp: int) -> dict:
    """The one level curve (the UI's engine.levelInfo): 100 XP for level 2, +20 per level after."""
    reach = lambda L: 100 * (L - 1) + 10 * (L - 1) * (L - 2)
    level = 1
    while reach(level + 1) <= xp:
        level += 1
    return {"level": level, "into": xp - reach(level), "need": reach(level + 1) - reach(level)}


def _day(s: str) -> date:
    return date.fromisoformat(s)


def node_status(bank: dict, st: dict, nid: str) -> str:
    """locked -> available (every prerequisite mastered) -> in_progress -> mastered."""
    rec = st["nodes"].get(nid) or {}
    if rec.get("status") == "mastered":
        return "mastered"
    if rec.get("status") == "in_progress":
        return "in_progress"
    node = bank["nodes"].get(nid)
    if node is None:
        return "locked"
    ok = all((st["nodes"].get(p) or {}).get("status") == "mastered" for p in node["prereqs"])
    return "available" if ok else "locked"


def statuses(bank: dict, st: dict) -> dict[str, str]:
    return {nid: node_status(bank, st, nid) for nid in bank["order"]}


def _direct_weight(bank: dict, car: Optional[dict], nid: str) -> float:
    if car is None:                                   # no career chosen: the best weight any career gives it
        return max([c["weights"].get(nid, 0.0) for c in bank["careers"]] or [0.5])
    return car["weights"].get(nid, 0.0)


def career_weight(bank: dict, st: dict, nid: str) -> float:
    """How much the chosen career wants this node. A maths-track node has no career
    weight of its own: it is worth what the career nodes that need it are worth,
    scaled by how much maths they need (skill tree v2's per-node maths weights),
    summed so a maths node many careers' nodes lean on comes before a niche one."""
    car = next((c for c in bank["careers"] if c["id"] == st.get("career")), None)
    if bank["careers"] and not any(nid in c["weights"] for c in bank["careers"]):
        demand = [_direct_weight(bank, car, k) * n["maths"][nid]
                  for k, n in bank["nodes"].items() if nid in (n.get("maths") or {})]
        if demand:
            return min(1.0, sum(demand) / 2)      # broad needs (probability, linear algebra) rank first
    return _direct_weight(bank, car, nid)


def branch_matches(node: dict, match: list[str]) -> bool:
    b = node["branch"].lower()
    return any(m.lower() in b for m in match if m)


def prereq_closure(bank: dict, nid: str) -> list[str]:
    """nid and everything it needs, in a valid learning order (prerequisites first)."""
    out: list[str] = []
    seen: set[str] = set()
    stack: list[tuple[str, bool]] = [(nid, False)]
    while stack:
        u, expanded = stack.pop()
        if u not in bank["nodes"]:
            continue
        if expanded:
            out.append(u)
            continue
        if u in seen:
            continue
        seen.add(u)
        stack.append((u, True))
        for p in reversed(bank["nodes"][u]["prereqs"]):
            if p not in seen:
                stack.append((p, False))
    return out


def _resource(bank: dict, rid: str) -> Optional[dict]:
    r = bank["resources"].get(rid)
    return dict(r) if r else None


def hash_string(s: str) -> int:
    h = 5381
    for ch in s:
        h = ((h << 5) + h + ord(ch)) & 0xFFFFFFFF
    return h


def wip(bank: dict, st: dict) -> list[str]:
    return [nid for nid in bank["order"] if node_status(bank, st, nid) == "in_progress"]


def contract_context(bank: dict, st: dict, node: dict) -> dict:
    """Everything needed to start a contract cold: what to read first (the node's
    primary resource, and the lesson of every prerequisite it builds on), the
    backup, and a legal PDF where one exists."""
    prim = _resource(bank, node["resources"][0]) if node["resources"] else None
    backup = _resource(bank, node["resources"][1]) if len(node["resources"]) > 1 else None
    depends = []
    for p in node["prereqs"]:
        pn = bank["nodes"][p]
        depends.append({"id": p, "name": pn["name"], "status": node_status(bank, st, p),
                        "resource": _resource(bank, pn["resources"][0]) if pn["resources"] else None})
    read_first = []
    if prim:
        read_first.append({**prim, "why": f"The main lesson for {node['name']}."})
    for d in depends:
        if d["resource"]:
            read_first.append({**d["resource"], "why": f"Builds on {d['name']}: skim it if it's rusty."})
    pdfs = [r for r in (_resource(bank, x) for x in node["resources"]) if r and r.get("legal_pdf_url")]
    return {"read_first": read_first, "depends_on": depends, "primary": prim, "backup": backup,
            "pdfs": [{"title": r["title"], "url": r["legal_pdf_url"]} for r in pdfs]}


def _tree_contract(bank: dict, st: dict, node: dict, c: dict, slot: str, why: str) -> dict:
    key = f"{node['id']}/{c['id']}"
    done = st["contracts"].get(key)
    return {"key": key, "source": "tree", "slot": slot, "node_id": node["id"], "node_name": node["name"],
            "branch": node["branch"], "title": c["title"], "minutes": c["minutes"], "xp": c["xp"],
            # the bank is checked for these (tests/test_mission_audit.py); a hand-edited
            # bank without them still never shows a blank card
            "context": c["context"] or f"Part of {node['name']}" + (f": {'; '.join(node['outcomes'][:2])}." if node["outcomes"] else "."),
            "steps": c["steps"], "hint": c["hint"] or "Try it before you read the answer; then read the main lesson.",
            "success_check": c["success_check"] or "Every step done, and you can explain it without notes.",
            "why": why or f"Next on {node['name']}", "done": bool(done), "verified": bool(done and done.get("verified")),
            **contract_context(bank, st, node)}


def open_contracts(st: dict, node: dict) -> list[dict]:
    return [c for c in node["contracts"] if f"{node['id']}/{c['id']}" not in st["contracts"]]


def rank_nodes(bank: dict, st: dict, match: Optional[list[str]], today: str) -> list[tuple[float, dict]]:
    """Candidate nodes for today's work, best first.

    Score = in progress (resume what you started) + career weight + membership of
    an active campaign + a little staleness, so a neglected in-progress node comes
    back before it is forgotten. Lower tiers first among equals; a per-day hash
    breaks ties, so the order is stable within a day."""
    sts = statuses(bank, st)
    active_paths: set[str] = set()
    for cid, cs in st["campaigns"].items():
        if cs.get("status") == "active":
            active_paths.update(prereq_closure(bank, cid.split("/", 1)[-1]))
    track_resume = {v.get("node") for v in st["resume"].values() if isinstance(v, dict)}
    out = []
    for nid in bank["order"]:
        node = bank["nodes"][nid]
        s = sts[nid]
        if s not in ("available", "in_progress") or not open_contracts(st, node):
            continue
        if match is not None and not branch_matches(node, match):
            continue
        rec = st["nodes"].get(nid) or {}
        score = career_weight(bank, st, nid) * 50
        if s == "in_progress":
            score += 100
            if rec.get("last"):
                score += min(14, (_day(today) - _day(rec["last"])).days)
        if nid in track_resume:
            score += 20                                  # where the rotation stopped last week
        if nid in active_paths:
            score += 40
        score -= node["tier"] * 2
        score += (hash_string(f"{today}|{nid}") % 100) / 1000
        out.append((score, node))
    out.sort(key=lambda x: -x[0])
    return out


def exam_state(ac: Optional[dict], st: dict, today: str, library_minutes: int = 180) -> Optional[dict]:
    """Exam mode, from academics. In order:
      1. he asked for it ("exam mode for DSP"): that subject owns the library block;
      2. the academics plan has a phase covering today: its blocks for today;
      3. an exam within the window (14 days): backlog first, then the nearest.
    Returns the blocks to turn into contracts, and what to say about it."""
    if not ac:
        return None
    win = int(st["exam"].get("window_days") or EXAM_WINDOW)
    t = _day(today)
    dated = []
    for s in ac["subjects"]:
        d, kind, approx = next_exam(ac, s, today)
        if d:
            dated.append((0 if s["kind"] == "backlog" else 1, (_day(d) - t).days, s, kind, approx))
    dated.sort(key=lambda x: (x[0], x[1]))
    need = lambda s: (s.get("pass_rule") or {}).get("see_needed_computed")
    queue = [{"id": s["id"], "name": s["name"], "kind": s["kind"], "days_left": left, "date_kind": k, "approx": a, "see_needed": need(s),
              "see_max": (s.get("pass_rule") or {}).get("see_max")}
             for _, left, s, k, a in sorted(dated, key=lambda x: x[1]) if left <= 60]
    undated_backlogs = [{"id": s["id"], "name": s["name"], "kind": "backlog", "days_left": None, "date_kind": "backlog block (date to confirm)",
                         "approx": True, "see_needed": need(s), "see_max": (s.get("pass_rule") or {}).get("see_max")}
                        for s in ac["subjects"] if s["kind"] == "backlog" and not next_exam(ac, s, today)[0]]
    focus = st["exam"].get("focus")
    forced = None
    if isinstance(focus, dict) and str(focus.get("until") or "9999") >= today:
        forced = next((s for s in ac["subjects"] if s["id"] == focus.get("subject")), None)
    phase = None if forced else active_phase(ac, today)
    if forced:
        blocks = [{"subject": forced["id"], "minutes": library_minutes, "note": ""}]
        subject = forced
    elif phase:
        # a "next-paper" block with no paper left to point at is dropped, not shown as
        # a card titled "next-internal-paper" (test audit)
        blocks = [b for b in phase_blocks(phase, today)
                  if b["subject"] not in ("next-paper", "next-internal-paper") or resolve_subject(ac, b["subject"], today)]
        if not blocks:                              # a day the plan leaves empty: the nearest paper, backlog first
            pick = dated[0][2] if dated else next((s for s in ac["subjects"] if s["kind"] == "backlog" and s["units"]), None)
            blocks = [{"subject": pick["id"], "minutes": library_minutes, "note": ""}] if pick else []
        first = next((resolve_subject(ac, b["subject"], today) for b in blocks if resolve_subject(ac, b["subject"], today)), None)
        subject = first
    else:
        near = [x for x in dated if 0 <= x[1] <= win]
        if not near:
            return None
        subject = near[0][2]
        blocks = [{"subject": subject["id"], "minutes": library_minutes, "note": ""}]
    left = None
    kind = None
    d = None
    if subject:
        d, kind, _ = next_exam(ac, subject, today)
        left = (_day(d) - t).days if d else None
    ph = phase["phase"] if phase else None
    advice = None
    if ph:
        advice = " ".join(x for x in (str(ph.get("note") or ""), str(ph.get("assumption") or "")) if x) or None
    elif left is not None:
        advice = plan_for_days(ac.get("plan") or {}, left)
    milestone = None
    if ph and phase:
        ms = sorted((m for m in _as_list(ph.get("milestones")) if isinstance(m, dict) and _num(m.get("days_left")) is not None
                     and _num(m.get("days_left")) <= phase["days_left"]), key=lambda m: -m["days_left"])
        milestone = ms[0].get("goal") if ms else None
    return {"subject": subject, "date": d, "days_left": left, "date_kind": kind, "forced": bool(forced), "queue": queue + undated_backlogs,
            "advice": advice, "blocks": blocks, "milestone": milestone,
            "phase": {"n": ph.get("phase"), "name": ph.get("name"), "days_left": phase["days_left"], "anchor": phase["anchor"],
                      "anchor_assumed": bool(phase.get("assumed"))} if ph else None,
            "rescue_week": rescue_week(ac, today)}


def _exam_public(exam: Optional[dict]) -> Optional[dict]:
    if not exam:
        return None
    s = exam["subject"]
    return {"subject": {"id": s["id"], "name": s["name"], "kind": s["kind"], "exam_date": exam.get("date"), "strategy": s["strategy"]} if s else None,
            "days_left": exam["days_left"], "date_kind": exam.get("date_kind"), "forced": exam["forced"], "queue": exam["queue"],
            "advice": exam["advice"], "phase": exam.get("phase"), "milestone": exam.get("milestone"), "rescue_week": exam.get("rescue_week")}


def resolve_subject(ac: dict, sid: str, today: str) -> Optional[dict]:
    """A block's subject: its id, or "next-internal-paper" / "next-paper" (the nearest dated one)."""
    hit = next((s for s in ac["subjects"] if s["id"] == sid), None)
    if hit:
        return hit
    if sid in ("next-internal-paper", "next-paper"):
        pool = [(next_exam(ac, s, today)[0], s) for s in ac["subjects"] if sid == "next-paper" or s["kind"] == "current"]
        pool = sorted((d, s["name"], s) for d, s in pool if d)
        return pool[0][2] if pool else None
    return None


def rescue_week(ac: dict, today: str) -> Optional[dict]:
    """The maths rescue's week plan line for this week ("2 (Oct 31-Nov 6)")."""
    r = ac.get("rescue") or {}
    year = _day(today).year
    for w in r.get("week_plan") or []:
        m = re.search(r"\((\w{3})\s+(\d+)\s*-\s*(?:(\w{3})\s+)?(\d+)\)", str(w.get("week") or ""))
        if not m:
            continue
        # Decision (test audit): the lines carry no year. A week that crosses New Year
        # ("Dec 28-Jan 3") ends in the next year, and on 2 January it started last
        # year; try both years rather than only today's, which never matched those.
        for y in (year, year - 1):
            try:
                a = datetime.strptime(f"{m.group(1)} {m.group(2)} {y}", "%b %d %Y").date()
                b = datetime.strptime(f"{m.group(3) or m.group(1)} {m.group(4)} {y}", "%b %d %Y").date()
            except ValueError:
                break
            if b < a:
                b = b.replace(year=y + 1)
            if a <= _day(today) <= b:
                return {"week": w.get("week"), "library": str(w.get("library") or ""), "evenings": str(w.get("evenings") or "")}
    return None


def _bank_contract_by_id(bank: dict, st: dict, cid: str, slot: str, why: str) -> Optional[dict]:
    nid = (bank.get("contract_index") or {}).get(cid)
    if not nid:
        return None
    node = bank["nodes"][nid]
    c = next((x for x in node["contracts"] if x["id"] == cid), None)
    return _tree_contract(bank, st, node, c, slot, why) if c else None


def rescue_contracts(bank: dict, st: dict, ac: dict, minutes: int, slot: str, taken: set[str]) -> list[dict]:
    """The maths rescue's triage, in order (tier A1 first), as real bank contracts."""
    out, used = [], 0
    for t in (ac.get("rescue") or {}).get("triage") or []:
        for cid in _str_list(t.get("contracts")):
            c = _bank_contract_by_id(bank, st, cid, slot, f"Maths rescue · Unit {t.get('unit')}: {t.get('title', '')} ({t.get('rescue_tier', '')})")
            if not c or c["done"] or c["key"] in taken:
                continue
            if out and used + c["minutes"] > minutes:
                return out
            out.append(c)
            used += c["minutes"]
            taken.add(c["key"])
    return out


def _unit_for(subject: dict, note: str) -> Optional[dict]:
    m = re.search(r"\bU(\d+)", note or "")
    if m:
        hit = next((u for u in subject["units"] if str(u["n"]) == m.group(1)), None)
        if hit:
            return hit
    return max(subject["units"], key=lambda u: u["exam_weight"]) if subject["units"] else None


def block_contracts(bank: dict, st: dict, ac: dict, exam: dict, today: str, slot: str) -> list[dict]:
    """Exam blocks → contracts. The maths backlog uses the rescue triage (bank
    contracts); every other block is one dated study contract for that subject,
    built from its unit (topics, must-do list, past papers)."""
    out: list[dict] = []
    taken: set[str] = set()
    days_left = exam.get("days_left")
    for i, b in enumerate(exam["blocks"]):
        sid, minutes, note = b["subject"], b["minutes"], b["note"]
        key = f"acad/{sid}/{today}/{i}"
        if sid in ("mock", "error-log"):
            title = "Timed full paper" if sid == "mock" else "Error log: redo every miss"
            out.append(_acad_contract(key, slot, None, title + (f" · {note}" if note else ""), minutes, note or title,
                                      ["Exam conditions: phone away, timer on" if sid == "mock" else "Open the error log",
                                       "Mark it against the key", "Write every miss into the error log"],
                                      "Score it honestly; the error log is where the marks come back.",
                                      "Paper done under time and marked." if sid == "mock" else "Every logged miss redone from blank.", [], [], st))
            continue
        s = resolve_subject(ac, sid, today)
        if s is None:
            out.append(_acad_contract(key, slot, None, f"{sid}{f' · {note}' if note else ''}", minutes, note, [note or sid], "", "Block done.", [], [], st))
            continue
        rescue = (ac.get("rescue") or {}).get("subject") == s["id"]
        if rescue:
            pyq_min = min(30, minutes // 3) if s.get("question_bank") and minutes >= 45 else 0
            got = rescue_contracts(bank, st, ac, minutes - pyq_min, slot, taken)
            if got:
                out += got
                if pyq_min:
                    unit_n = _roman((ac.get("rescue") or {}).get("triage", [{}])[0].get("unit")) if (ac.get("rescue") or {}).get("triage") else None
                    q = pick_questions(s, unit_n, pyq_min, st, taken)
                    if q:
                        out.append(_pyq_contract(f"{key}/pyq", slot, s, q, pyq_min, st))
                continue
        u = _unit_for(s, note)
        if u and days_left is not None and days_left <= 7 and u["skip_if_short"]:
            u = max((x for x in s["units"] if not x["skip_if_short"]), key=lambda x: x["exam_weight"], default=u)
        res = [r for r in (_resource(bank, x) for x in (u["resources"] if u else [])) if r]
        steps = ["15 min: write the formula sheet / key points from memory, then check"]
        if u:
            steps.append(f"Study: {', '.join(u['topics'][:5]) or u['title']}" + (f" ({res[0]['title']})" if res else ""))
            steps += [f"Must do: {x}" for x in u["must_do"][:2]]
            if u["pyq_refs"]:
                steps.append("Past-paper question under time: " + "; ".join(u["pyq_refs"][:2]))
        title = f"{s['name']} · {note}" if note else f"{s['name']} · Unit {u['n']}: {u['title']}" if u else s["name"]
        ctx = (f"{u['weight_label'].capitalize()}-weight unit. " if u and u["weight_label"] else "") + (s["strategy"] or "")
        qs = pick_questions(s, u["n"] if u else None, max(10, minutes // 2), st, taken) if s.get("question_bank") else []
        if qs:
            steps = [x for x in steps if not x.startswith("Past-paper question")] + [_q_step(q) for q in qs]
        c = _acad_contract(key, slot, s, title, minutes, ctx, steps,
                           "Closed book first; the notes are for checking, not for reading.",
                           "Formula sheet written blind, and every past-paper question answered under time." if qs else
                           "Formula sheet written blind, and the past-paper question answered under time.", res,
                           u["pyq_refs"] if u else [], st)
        c["files"] = (u.get("files") if u else []) + [q["file"] for q in qs if q.get("file")][:1]
        c["questions"] = qs
        c["pass"] = s.get("pass_rule")
        out.append(c)
    return out


def _roman(v: Any) -> Optional[int]:
    table = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6}
    try:
        return int(v)
    except (TypeError, ValueError):
        return table.get(str(v or "").strip().upper())


def pick_questions(s: dict, unit: Optional[int], minutes: int, st: dict, taken: set[str]) -> list[dict]:
    """Real past-paper questions for a unit, not yet done, fitted to the time (about
    3 minutes a mark, the SEE's pace). Long questions first: that's where the marks are."""
    done = set(st.get("questions_done") or [])
    pool = [q for q in s.get("question_bank") or [] if (unit is None or q["unit"] == unit) and q["id"] not in done and q["id"] not in taken]
    if not pool and unit is not None:
        pool = [q for q in s.get("question_bank") or [] if q["id"] not in done and q["id"] not in taken]
    pool.sort(key=lambda q: (-(q["marks"] or 0), q["sitting"], q["choice_group"]))
    out, used = [], 0
    for q in pool:
        need = int((q["marks"] or 5) * 3)
        if out and used + need > minutes:
            continue
        out.append(q)
        taken.add(q["id"])
        used += need
        if used >= minutes:
            break
    return out


def _q_step(q: dict) -> str:
    where = " ".join(x for x in (q["sitting"], f"Q{q['choice_group']}" if q["choice_group"] else "") if x)
    marks = f" ({int(q['marks'])} marks)" if q["marks"] else ""
    return f"Solve {where}{marks}: {q['question']}"


def _pyq_contract(key: str, slot: str, s: dict, qs: list[dict], minutes: int, st: dict) -> dict:
    first = qs[0]
    where = " ".join(x for x in (first["sitting"].split(" (")[0], f"Q{first['choice_group']}" if first["choice_group"] else "") if x)
    c = _acad_contract(key, slot, s, f"Solve {where}: {first['topic'] or first['question'][:50]}", minutes,
                       "A real question from a paper this examiner set. Timed, closed book.", [_q_step(q) for q in qs],
                       "Write the method name before you start; step marks come from the method.",
                       "Every question answered under time and checked against your notes; misses into the error log.", [], [], st)
    c["files"] = [q["file"] for q in qs if q.get("file")][:1]
    c["questions"] = qs
    c["pass"] = s.get("pass_rule")
    return c


def _acad_contract(key: str, slot: str, s: Optional[dict], title: str, minutes: int, context: str, steps: list[str],
                   hint: str, check: str, res: list[dict], pyqs: list[str], st: dict) -> dict:
    done = st["contracts"].get(key)
    # Constraint: every contract has context, a hint and a success check. A plan block
    # whose subject isn't in academics.json, or a unit with no weight and no strategy,
    # left these empty; plain defaults beat a blank card.
    what = s["name"] if s else (title or "this block")
    context = context or f"From your exam plan: {what}. Work it closed book, then check against the notes."
    hint = hint or "Start with what you can do from memory; the gaps you find are the block's real work."
    check = check or "The block's steps done, and every miss written into the error log."
    return {"key": key, "source": "academics", "slot": slot, "node_id": None, "node_name": s["name"] if s else None,
            "subject_id": s["id"] if s else None, "branch": "academics", "title": title, "minutes": minutes,
            "xp": max(10, min(60, minutes // 4)), "context": context, "steps": steps, "hint": hint, "success_check": check,
            "why": "Exam plan", "done": bool(done), "verified": bool(done and done.get("verified")),
            "read_first": [{**r, "why": "Course material for this unit."} for r in res], "depends_on": [],
            "primary": res[0] if res else None, "backup": res[1] if len(res) > 1 else None,
            "pdfs": [{"title": r["title"], "url": r["legal_pdf_url"]} for r in res if r.get("legal_pdf_url")], "pyq_refs": pyqs}


def unit_contracts(bank: dict, st: dict, subject: dict, days_left: Optional[int], slot: str, budget: int, today: str = "") -> list[dict]:
    """Outside a phase plan: a subject's units by exam weight, sized to the block."""
    units = [u for u in subject["units"] if not (u["skip_if_short"] and days_left is not None and days_left <= 7)]
    units.sort(key=lambda u: -u["exam_weight"])
    out, used = [], 0
    for u in units:
        key = f"acad/{subject['id']}/u{u['n']}"
        if key in st["contracts"]:
            continue
        minutes = 90 if u["exam_weight"] >= 0.25 else 60
        if out and used + minutes > budget:
            break
        res = [r for r in (_resource(bank, x) for x in u["resources"]) if r]
        steps = [f"Study: {', '.join(u['topics']) or u['title']}" + (f" ({res[0]['title']})" if res else ""),
                 "Write a one-page summary from memory, then check it against the notes"]
        if u["pyq_refs"]:
            steps.append("Past-paper questions under time: " + "; ".join(u["pyq_refs"]))
        c = _acad_contract(key, slot, subject, f"{subject['name']} · Unit {u['n']}: {u['title']}", minutes,
                           f"About {round(u['exam_weight'] * 100)}% of the paper." + (f" {subject['strategy']}" if subject["strategy"] else ""),
                           steps, "Past papers first if time is short: they show what the examiner rewards.",
                           "Every PYQ attempted under time, and the summary page written without looking.", res, u["pyq_refs"], st)
        c["why"] = f"{subject['name']} exam" + (f" in {days_left} day{'s' if days_left != 1 else ''}" if days_left is not None else "")
        out.append(c)
        used += minutes
    return out


def practice_rules(bank: dict) -> list[str]:
    """The evening routine from math-track's practice_engine.rules (an object with
    daily_session.evening_home_30_45min in the real bank; a plain list is fine too)."""
    rules = (bank["math"].get("practice_engine") or {}).get("rules")
    if isinstance(rules, list):
        return [str(r) for r in rules if isinstance(r, (str, int, float))]
    if isinstance(rules, dict):
        ds = rules.get("daily_session") if isinstance(rules.get("daily_session"), dict) else {}
        ev = next((v for k, v in ds.items() if k.startswith("evening") and isinstance(v, list)), None)
        if ev:
            return [str(x) for x in ev]
        rt = rules.get("retrieval")
        if isinstance(rt, dict) and rt.get("rule"):
            return [str(rt["rule"])]
    return []


def _practice_contract(bank: dict, st: dict, today: str, minutes: int, avoid_branch: Optional[str], exam: Optional[dict],
                       ac: Optional[dict] = None) -> Optional[dict]:
    """The evening block: practice questions + JARVIS on something learned before.
    Spaced recall on a node from another track, or PYQs in exam mode."""
    key = f"practice/{today}"
    rules = practice_rules(bank)
    base = {"key": key, "source": "practice", "slot": "evening", "minutes": minutes, "xp": 20, "why": "Evening practice",
            "done": False, "verified": False, "read_first": [], "depends_on": [], "primary": None, "backup": None, "pdfs": []}
    if exam and ac and (ac.get("rescue") or {}).get("subject"):
        feed = foundation_contract(bank, st, ac)
        if feed:
            return feed
    if exam and exam.get("subject"):
        s = exam["subject"]
        pyqs = [p for u in s["units"] for p in u["pyq_refs"]][:6]
        return {**base, "node_id": None, "node_name": s["name"], "branch": "academics", "title": f"Evening PYQs · {s['name']}",
                "context": "Past-paper questions, then ask JARVIS to quiz you on what you missed.",
                "steps": ["Pick three past-paper questions" + (f": {'; '.join(pyqs)}" if pyqs else ""), "Answer under time",
                          f"Say: \"Jarvis, quiz me on {s['name']}\""],
                "hint": "Mark the ones you guessed; those are tomorrow's first block.", "success_check": "Three questions answered and checked."}
    pool = []
    for nid in bank["order"]:
        rec = st["nodes"].get(nid) or {}
        if rec.get("status") not in ("in_progress", "mastered", "paused") or not rec.get("last"):
            continue
        age = (_day(today) - _day(rec["last"])).days
        if age < 1:
            continue
        node = bank["nodes"][nid]
        other = avoid_branch is None or node["branch"] != avoid_branch
        pool.append(((2 if other else 0) + min(age, 7) / 7 + career_weight(bank, st, nid), node))
    if not pool:
        return None
    node = max(pool, key=lambda x: x[0])[1]
    return {**base, "node_id": node["id"], "node_name": node["name"], "branch": node["branch"],
            "title": f"Evening practice · {node['name']}",
            "context": "Spaced recall: questions on something you learned days ago stick far better than re-reading.",
            "steps": ["Ten questions on: " + ("; ".join(node["outcomes"][:3]) or node["name"]),
                      f"Say: \"Jarvis, quiz me on {node['name']}\" and explain one answer aloud"] + [f"Rule: {r}" for r in rules[:2]],
            "hint": "Answer before you look anything up; a wrong guess you correct is worth more than a right one you read.",
            "success_check": "7 of 10 or better, and every miss written down.", **contract_context(bank, st, node)}


def foundation_contract(bank: dict, st: dict, ac: dict) -> Optional[dict]:
    """The maths rescue's evening: the next foundation contract for the unit the
    library is about to reach (foundation_feed), as a real bank contract."""
    r = ac.get("rescue") or {}
    feed = r.get("foundation_feed") or {}
    for t in r.get("triage") or []:
        if not any((_bank_contract_by_id(bank, st, c, "evening", "") or {"done": True})["done"] is False for c in _str_list(t.get("contracts"))):
            continue
        for cid in _str_list(feed.get(str(t.get("unit")))):
            c = _bank_contract_by_id(bank, st, cid, "evening", f"Evening foundation for maths Unit {t.get('unit')}")
            if c and not c["done"]:
                return c
        break
    return None


def _fill_from_nodes(bank: dict, st: dict, ranked: list[tuple[float, dict]], budget: int, slot: str, why: str, max_n: int = 4) -> list[dict]:
    """Fill a block with contracts from the ranked nodes. A node not started yet
    may only be used while the in-progress cap has room."""
    out, used = [], 0
    room = max(0, int(st.get("wip_cap") or WIP_CAP) - len(wip(bank, st)))
    for _, node in ranked:
        new = node_status(bank, st, node["id"]) == "available"
        if new and room <= 0:
            continue
        took = False
        for c in open_contracts(st, node):
            if len(out) >= max_n or (out and used + c["minutes"] > budget):
                break
            out.append(_tree_contract(bank, st, node, c, slot, why))
            used += c["minutes"]
            took = True
        if took and new:
            room -= 1
        if used >= budget or len(out) >= max_n:
            break
    return out


def build_day(bank: dict, st: dict, ac: Optional[dict], today: str) -> dict:
    """Today's plan: blocks and their contracts. Frozen once made (the day is
    stored), so finishing one contract never reshuffles the others."""
    iso = _day(today).isoweekday()
    sched = st["schedule"]
    exam = exam_state(ac, st, today)
    rot = st["rotation"].get(str(iso)) if iso <= 5 else None
    blocks: list[dict] = []
    contracts: list[dict] = []
    note = None
    protected = sched["protected"]
    if iso <= 5:
        lib = sched["library"]
        track = rot or {"track": "mixed", "label": "Mixed", "match": []}
        if exam:
            items = block_contracts(bank, st, ac, exam, today, "library")
            ph = exam.get("phase")
            label = f"Exam plan · {ph['name']}" if ph else f"Exam mode · {exam['subject']['name']}"
        elif track["track"] == "academics":
            subj = None
            if ac and ac["subjects"]:
                dated = sorted(((next_exam(ac, s, today)[0], s) for s in ac["subjects"] if next_exam(ac, s, today)[0] and s["units"]),
                               key=lambda x: (x[1]["kind"] != "backlog", x[0]))
                # a re-sit still waiting for its date comes before "any subject"; a paper
                # already written does not (test audit: Thursdays kept prepping it)
                undated = lambda s: not any(v for k, v in (s.get("dates") or {}).items() if k != "end_sem_approx")
                subj = (dated[0][1] if dated else None) \
                    or next((s for s in ac["subjects"] if s["kind"] == "backlog" and undated(s) and s["units"]), None) \
                    or next((s for s in ac["subjects"] if undated(s) and s["units"]), None)
            items = []
            if subj:
                d = next_exam(ac, subj, today)[0]
                left = (_day(d) - _day(today)).days if d else None
                items = unit_contracts(bank, st, subj, left, "library", lib["minutes"])
                label = f"Academics · {subj['name']}"
            if subj and not items:
                # every unit of it already done: the block is not left empty (90-day run)
                items = _fill_from_nodes(bank, st, rank_nodes(bank, st, None, today), lib["minutes"], "library",
                                         f"Academics day: {subj['name']}'s units are all done, so the best next node")
                note = f"Every {subj['name']} unit is done; Thursday borrows from the tree."
            elif not subj and ac and ac["subjects"]:
                items = _fill_from_nodes(bank, st, rank_nodes(bank, st, None, today), lib["minutes"], "library",
                                         "Academics day: no paper ahead, so the best next node")
                label = "Academics (no paper ahead)"
                note = "No exam is coming up, so Thursday borrows from the tree."
            elif not subj:
                items = _fill_from_nodes(bank, st, rank_nodes(bank, st, None, today), lib["minutes"], "library", "Academics day: no academics file yet")
                label = "Academics (waiting for academics.json)"
                note = "academics.json isn't there yet, so Thursday borrows from the tree."
        else:
            ranked = rank_nodes(bank, st, track["match"], today)
            label = track["label"]
            why = f"{track['label']} day"
            if not ranked:
                ranked = rank_nodes(bank, st, None, today)
                why = f"{track['label']} day: nothing open on this track, so the best next node anywhere"
                # skill tree v2: first what unlocks the track (its locked nodes' prerequisites,
                # usually maths), so a track day is never spent on an unrelated branch
                unlock: set[str] = set()
                for k in bank["order"]:
                    if track["match"] and branch_matches(bank["nodes"][k], track["match"]):
                        unlock.update(prereq_closure(bank, k))
                towards = [x for x in ranked if x[1]["id"] in unlock]
                if towards:
                    ranked = towards
                    why = f"{track['label']} day: nothing open on this track yet, so what unlocks it"
                if ranked:
                    note = f"Nothing is open on the {track['label']} track; today borrows the best next node."
            items = _fill_from_nodes(bank, st, ranked, lib["minutes"], "library", why)
        blocks.append({"id": "library", "kind": "library", "label": f"Library · {label}", "start": lib["start"], "minutes": lib["minutes"], "track": track["track"]})
        contracts += items
        blocks.append({"id": "protected", "kind": "protected", "label": protected.get("label") or "Social · rest", "start": protected["start"], "minutes": protected["minutes"]})
        ev = sched["evening"]
        avoid = next((c["branch"] for c in items if c.get("branch")), None)
        pr = _practice_contract(bank, st, today, ev["minutes"], avoid, exam, ac)
        blocks.append({"id": "evening", "kind": "evening", "label": "Evening · practice questions + JARVIS", "start": ev["start"], "minutes": ev["minutes"]})
        if pr:
            contracts.append(pr)
    else:
        wk = sched["weekend"]
        blocks.append({"id": "weekend", "kind": "weekend", "label": "Weekend · one light block", "start": wk["start"], "minutes": wk["minutes"]})
        if exam:
            contracts += block_contracts(bank, st, ac, exam, today, "weekend")
        else:
            room = max(0, int(st.get("wip_cap") or WIP_CAP) - len(wip(bank, st)))
            light = sorted(((c["minutes"], i, n, c) for i, (_, n) in enumerate(rank_nodes(bank, st, None, today))
                            if room > 0 or node_status(bank, st, n["id"]) == "in_progress"
                            for c in open_contracts(st, n)[:1]), key=lambda x: (x[0] > wk["minutes"], x[1]))
            if light:
                _, _, n, c = light[0]
                contracts.append(_tree_contract(bank, st, n, c, "weekend", "Weekend: one small win"))
        blocks.append({"id": "protected", "kind": "protected", "label": protected.get("label") or "Social · rest", "start": "18:00", "minutes": 240})
    return {"date": today, "weekday": iso, "track": (rot or {}).get("track") if iso <= 5 else "weekend",
            "track_label": (rot or {}).get("label") if iso <= 5 else "Weekend", "blocks": sorted(blocks, key=lambda b: b["start"]),
            "contracts": contracts, "exam": _exam_public(exam), "note": note}


def contract_lookup(bank: dict, st: dict, ac: Optional[dict], key: str, today: str) -> Optional[dict]:
    """One contract by key: today's frozen ones first, else rebuilt from the bank."""
    for c in (st["days"].get(today) or {}).get("contracts", []):
        if c["key"] == key:
            return refresh_contract(bank, st, c)
    if key.startswith("quest/"):
        q = wellwisher.parse_key(key)
        lines = wellwisher.load_questlines()
        line = lines["lines"].get(q[0]) if q else None
        rec = (st.get("quests") or {}).get(q[0]) if q else None
        if not (line and rec and rec.get("on")) or q[2] != today:     # a quest is for its own day only
            return None
        return wellwisher.quest_contract(line, wellwisher.quest_record(st, line), st, q[2], q[1])
    if key.startswith("refresh/"):
        parts = key.split("/")
        if len(parts) == 3 and parts[1] in bank["nodes"]:
            hit = next((r for r in refreshers(bank, st, parts[2], load_profile()) if r["key"] == key), None)
            if hit:
                return hit
        return None
    if key.startswith("acad/"):
        if not ac:
            return None
        parts = key.split("/")
        subj = next((s for s in ac["subjects"] if s["id"] == parts[1]), None)
        if subj and len(parts) == 3:
            for c in unit_contracts(bank, {**st, "contracts": {}}, subj, None, "extra", 10_000):
                if c["key"] == key:
                    return c
        return None
    if "/" in key and not key.startswith("practice/"):
        nid, cid = key.split("/", 1)
        node = bank["nodes"].get(nid)
        c = next((x for x in (node or {}).get("contracts", []) if x["id"] == cid), None)
        if node and c:
            return _tree_contract(bank, st, node, c, "extra", "Picked from the tree")
    return None


_REBUILT = ("read_first", "depends_on", "primary", "backup", "pdfs")


def frozen(c: dict) -> dict:
    """What a stored day keeps of a contract. A tree contract's reading list is rebuilt
    from the bank on every read (refresh_contract), so storing it only made the state
    ~2x larger and every load/save slower (test audit: 12 KB a day, 45 days kept)."""
    if c.get("source") != "tree":
        return c
    return {k: v for k, v in c.items() if k not in _REBUILT}


def refresh_contract(bank: dict, st: dict, c: dict) -> dict:
    """A frozen contract with today's done state and the bank's current text."""
    done = st["contracts"].get(c["key"])
    if c["source"] == "tree" and c.get("node_id") in bank["nodes"]:
        node = bank["nodes"][c["node_id"]]
        bc = next((x for x in node["contracts"] if f"{node['id']}/{x['id']}" == c["key"]), None)
        if bc:
            c = _tree_contract(bank, st, node, bc, c["slot"], c.get("why", ""))
    if c["source"] == "tree":                       # gone from the bank: the stored text, no reading list
        c = {"read_first": [], "depends_on": [], "primary": None, "backup": None, "pdfs": [], **c}
    return {**c, "done": bool(done), "verified": bool(done and done.get("verified"))}


def rep_for(branch: Optional[str]) -> Optional[str]:
    """Which Floor rep a piece of work counts for."""
    b = (branch or "").lower()
    if re.search(r"german|deutsch", b):
        return "deutsch"
    if re.search(r"body|gym|fitness|workout", b):
        return "body"
    return "silicon" if b else None


def match_subject(ac: dict, words: str) -> Optional[dict]:
    """A subject by what he says: its id, its name, its initials ("EMT", "NAS"), or most of its words."""
    w = " ".join(re.findall(r"[a-z0-9&]+", (words or "").lower()))
    if not w:
        return None
    best, score = None, 0.0
    for s in ac["subjects"]:
        name = s["name"].lower()
        initials = "".join(x[0] for x in re.findall(r"[a-z]+", name) if x not in ("and", "of", "the"))
        code = re.sub(r"[^a-z0-9]", "", (s.get("code") or "").lower())
        if w in (s["id"].lower(), name, initials) or (code and re.sub(r"[^a-z0-9]", "", w) == code):
            return s
        toks = [t for t in w.split() if len(t) > 2 and t not in ("exam", "the", "for", "paper", "and")]
        name_toks = set(re.findall(r"[a-z0-9]+", name))
        sc = sum(1 for t in toks if t in name_toks or any(n.startswith(t) or n.startswith(t.rstrip("s")) for n in name_toks)) / max(1, len(toks))
        if sc > score:
            best, score = s, sc
    return best if score >= 0.5 else None


def word_score(query: str, target: str) -> float:
    """The UI's wordScore: share of the query's words found in the target."""
    norm = lambda s: [w for w in re.sub(r"[^a-z0-9äöüß ]+", " ", s.lower()).split() if len(w) > 2]
    q = norm(query)
    if not q:
        return 0.0
    t = set(norm(target))
    return sum(1 for w in q if w in t or any(x.startswith(w) or w.startswith(x) for x in t)) / len(q)


# ------------------------------------------------------------------ the store (one writer)
class Plan:
    """The plan state lives in the same key-value store as the rest of Mission
    Germoney (so the daily snapshots cover it), under one key only the server
    writes. The UI and the voice both change it through these methods."""

    def __init__(self, kv: KVStore, bank_loader=None, academics_loader=None, apps: Optional["Applications"] = None):
        self.kv = kv
        self._bank = bank_loader or load_bank
        self._ac = academics_loader or load_academics
        self._lock = threading.RLock()
        self.apps = apps if apps is not None else Applications()

    def bank(self) -> dict:
        return self._bank()

    def academics(self) -> Optional[dict]:
        return self._ac()

    # ---- load / save / migrate
    def load(self, today: Optional[str] = None) -> dict:
        today = today or date.today().isoformat()
        with self._lock:
            raw = self.kv.get(PLAN_KEY)
            if raw:
                try:
                    st = merge_plan_state(json.loads(raw), today)
                    if PROFILE.exists():                # his profile sets the cap (3 by default)
                        st["wip_cap"] = int(load_profile()["style"].get("wip_cap") or WIP_CAP)
                    return st
                except ValueError:
                    pass
            st = self.migrate(today)
            self.save(st)
            return st

    def migrate(self, today: str) -> dict:
        """First run of v2: the one XP total starts from the XP he already has
        (@silicon_player_v2), so nothing is lost; every old key stays as it is."""
        st = default_plan_state(today)
        try:
            player = json.loads(self.kv.get(PLAYER_KEY) or "{}")
            st["xp"] = max(0, int(player.get("xp") or 0))
            st["xp_migrated_from"] = st["xp"]
        except (ValueError, TypeError, AttributeError):
            pass
        st["events"].append({"id": f"{today}:0", "t": time.time(), "date": today, "kind": "migrate", "xp": 0,
                             "note": f"Mission v2 started with the {st['xp']} XP already earned"})
        return st

    def save(self, st: dict) -> None:
        if len(st["events"]) > 1500:               # Well Wisher: trimmed events still count (wellwisher.fold_events)
            st["archive"] = wellwisher.fold_events(st.get("archive") or {}, st["events"][:-1500])
        st["events"] = st["events"][-1500:]
        cutoff = (date.today() - timedelta(days=45)).isoformat()
        st["days"] = {k: v for k, v in st["days"].items() if k >= cutoff}
        self.kv.set(PLAN_KEY, json.dumps(st))

    def _event(self, st: dict, today: str, kind: str, **kw) -> dict:
        st["seq"] = int(st.get("seq") or 0) + 1
        ev = {"id": f"{today}:{st['seq']}", "t": time.time(), "date": today, "kind": kind, **kw}
        st["events"].append(ev)
        return ev

    # ---- the day
    def today(self, today: Optional[str] = None) -> dict:
        today = today or date.today().isoformat()
        with self._lock:
            bank, ac = self.bank(), self.academics()
            st = self.load(today)
            day = st["days"].get(today)
            exam_now = _exam_public(exam_state(ac, st, today))
            def sid(x: Optional[dict]) -> Optional[str]:
                return ((x or {}).get("subject") or {}).get("id")
            if day is None or (not day.get("contracts") and bank["order"]) or sid(day.get("exam")) != sid(exam_now):
                day = build_day(bank, st, ac, today)
                st["days"][today] = {**day, "contracts": [frozen(c) for c in day["contracts"]]}
                self.save(st)
            contracts = [refresh_contract(bank, st, c) for c in day["contracts"]]
            av = None
            try:
                av = self.apps.view(today, bank, st)
                due = [{"id": a["id"], "org": a["org"], "programme": a["programme"], "closes": a["closes"], "days_left": a["days_left"],
                        "status": a["status"], "url": a["url"], "prep": a["prep"], "verified": a["verified"]} for a in av["due_soon"]]
                due += [{"id": x["id"], "org": "Prep", "programme": x["title"], "closes": x.get("due"), "days_left": x["days_left"],
                         "status": "task", "url": "", "prep": [], "verified": True} for x in av["due_tasks"]]
            except Exception:                         # a broken applications file must not take the day down
                due = []
            profile = load_profile()
            ladder = load_ladder()
            app_nodes = {n for a in (av or {}).get("applications", []) if a["status"] in ("idea", "preparing", "applied") for n in a["linked_nodes"]}
            wb = welcome_back(bank, st, av, today, profile)
            keys = {c["key"] for c in contracts}
            refresh = [r for r in refreshers(bank, st, today, profile) if r["key"] not in keys][:1 if not wb else 2]
            contracts += refresh
            contracts += wellwisher.quest_contracts(wellwisher.load_questlines(), st, today)
            for c in contracts:
                c["serves"] = serves_for(c, ladder, today, ac, app_nodes)
                if profile["style"].get("novelty_first") and c["source"] == "tree" and c.get("success_check") and not c["done"]:
                    c["hook"] = f"Puzzle first: try it cold for ten minutes, then read. Done when: {c['success_check']}"
            alternatives = []
            n_choice = int(profile["style"].get("choices") or 3)
            if n_choice > 1 and any(c["slot"] == "library" and c["source"] == "tree" and not c["done"] for c in contracts):
                # a new node is offered only while the cap has room beyond the new nodes
                # already planned today (the same rule choose() enforces)
                planned_new = {c["node_id"] for c in contracts if c["source"] == "tree" and c.get("node_id") in bank["nodes"]
                               and node_status(bank, st, c["node_id"]) == "available"}
                room = st["wip_cap"] - len(wip(bank, st)) - len(planned_new)
                for _, node in rank_nodes(bank, st, None, today):
                    if len(alternatives) >= n_choice - 1:
                        break
                    if node_status(bank, st, node["id"]) == "available" and node["id"] not in planned_new and room <= 0:
                        continue
                    oc = next((c for c in open_contracts(st, node) if f"{node['id']}/{c['id']}" not in keys), None)
                    if oc:
                        alt = _tree_contract(bank, st, node, oc, "library", "An alternative: pick what pulls you today")
                        alt["serves"] = serves_for(alt, ladder, today, ac, app_nodes)
                        alternatives.append(alt)
            three = weekly = None
            try:                                      # the Well Wisher read; a bad input file must not take the day down
                inputs = ww_engines.load_inputs()
                data = ww_data(bank, st, today, av)
                three = ww_engines.today_three(inputs, today, candidates=contracts, done=set(st["contracts"]),
                                               nodes=data["nodes"], applications=data["applications"],
                                               open_projects=data["open_projects"], active_days=data["active_days"])
                w = ww_engines.insight(inputs, today, events=data["events"], planned=data["planned"], nodes=data["nodes"])
                weekly = {k: w[k] for k in ("week", "totals", "moved", "stalled", "change", "say")}
            except Exception:
                pass
            return {**day, "contracts": contracts, "alternatives": alternatives, "welcome_back": wb, "deadlines": due,
                    "three": three, "weekly": weekly,
                    "wins": self.wins(st, today), "wip": wip(bank, st), "wip_cap": st["wip_cap"],
                    "level": level_info(st["xp"]), "xp": st["xp"], "bank_ready": bool(bank["order"]),
                    "academics_ready": ac is not None, "cursor": st.get("cursor")}

    def choose(self, key: str, alt_key: str, today: Optional[str] = None) -> dict:
        """Swap one of today's open library contracts for an alternative (choice beats a fixed task)."""
        today = today or date.today().isoformat()
        with self._lock:
            bank = self.bank()
            st = self.load(today)
            day = st["days"].get(today)
            if not day:
                raise KeyError("no plan for today yet")
            i = next((k for k, c in enumerate(day["contracts"]) if c["key"] == key), None)
            if i is None or key in st["contracts"]:
                raise KeyError(key)
            alt = contract_lookup(bank, st, self.academics(), alt_key, today)
            if alt is None or alt_key in st["contracts"] or any(c["key"] == alt_key for c in day["contracts"]):
                raise KeyError(alt_key)
            # Decision (test audit): any key could be swapped in, so a locked node, or a
            # fourth new node past the cap, got into today's plan. An alternative must be
            # one the engine itself could have offered.
            an = alt.get("node_id")
            if an in bank["nodes"]:
                s = node_status(bank, st, an)
                room = int(st.get("wip_cap") or WIP_CAP) - len(wip(bank, st))
                if s == "locked":
                    raise ValueError(f"{bank['nodes'][an]['name']} is locked: its prerequisites aren't mastered yet")
                planned_new = {c.get("node_id") for k, c in enumerate(day["contracts"]) if k != i and c.get("source") == "tree"
                               and c.get("node_id") in bank["nodes"] and node_status(bank, st, c["node_id"]) == "available"}
                if s == "available" and an not in planned_new and room - len(planned_new) <= 0:
                    raise ValueError(f"{st['wip_cap']} things are in progress already; finish or pause one first")
            alt = {**alt, "slot": day["contracts"][i]["slot"], "why": "You picked this one"}
            day["contracts"][i] = frozen(alt)
            self.save(st)
        return {"ok": True, "say": f"Swapped in: {alt['title']}."}

    def reroll(self, today: Optional[str] = None) -> dict:
        today = today or date.today().isoformat()
        with self._lock:
            st = self.load(today)
            st["days"].pop(today, None)
            self.save(st)
        return self.today(today)

    @staticmethod
    def wins(st: dict, today: str) -> dict:
        """Small wins, counted every day: the screen and the voice say them out loud."""
        evs = [e for e in st["events"] if e.get("date") == today]
        return {"contracts": sum(1 for e in evs if e["kind"] == "contract"),
                "minutes": sum(int(e.get("minutes") or 0) for e in evs if e["kind"] in ("contract", "log")),
                "xp": sum(int(e.get("xp") or 0) for e in evs if e["kind"] != "migrate"),
                "nodes": sorted({e["node"] for e in evs if e.get("node")}),
                "mastered": sum(1 for e in evs if e["kind"] == "node" and e.get("note") == "mastered"),
                "shipped": sum(1 for e in evs if e["kind"] in ("ship", "project", "cert"))}

    # ---- contracts and nodes
    def complete(self, key: str, proof: str = "", verified: Optional[bool] = None, today: Optional[str] = None, via: str = "ui") -> dict:
        today = today or date.today().isoformat()
        with self._lock:
            bank, ac = self.bank(), self.academics()
            st = self.load(today)
            c = contract_lookup(bank, st, ac, key, today)
            if c is None:
                raise KeyError(f"no contract {key}")
            if key in st["contracts"]:
                return {"ok": False, "already": True, "contract": c, "say": f"{c['title']} is already done."}
            ver = bool(re.match(r"^https?://", (proof or "").strip())) if verified is None else bool(verified)
            st["contracts"][key] = {"done": today, "at": time.time(), "proof": (proof or "")[:400], "verified": ver,
                                    "xp": c["xp"], "node": c.get("node_id"), "via": via}
            if c.get("questions"):
                st["questions_done"] = list(dict.fromkeys((st.get("questions_done") or []) + [q["id"] for q in c["questions"]]))[-2000:]
            st["xp"] += c["xp"]
            ev = self._event(st, today, "contract", key=key, title=c["title"], minutes=c["minutes"], xp=c["xp"], node=c.get("node_id"),
                             branch=c.get("branch"), rep=rep_for(c.get("branch")), verified=ver, via=via)
            mastered = None
            queued = None
            nid = c.get("node_id")
            if nid in bank["nodes"]:
                before = node_status(bank, st, nid)
                rec = st["nodes"].setdefault(nid, {})
                rec["last"] = today
                if c["source"] == "tree":
                    # Decision (test audit): finishing a contract is always recorded (the
                    # work happened), but it only moves the NODE when the tree allows it:
                    # a locked node never becomes in progress or mastered before its
                    # prerequisites, and a new node never pushes past the in-progress cap
                    # (a contract picked from the tree, or one frozen into today before
                    # another node was started). Such a node stays queued, and is mastered
                    # by its next contract once it is allowed.
                    cap_full = before == "available" and len(wip(bank, st)) >= int(st.get("wip_cap") or WIP_CAP)
                    if before == "locked" or cap_full:
                        queued = "locked" if before == "locked" else "cap"
                    elif rec.get("status") != "mastered":
                        rec.setdefault("started", today)
                        rec["status"] = "in_progress"
                    track = (st["rotation"].get(str(_day(today).isoweekday())) or {}).get("track")
                    if track:
                        st["resume"][track] = {"node": nid, "at": today}
                    if not queued and not open_contracts(st, bank["nodes"][nid]) and rec.get("status") != "mastered":
                        mastered = self._master(st, nid, today)
                settle = bool(mastered)              # a queued node whose contracts are all done unlocks with it
                while settle:
                    settle = False
                    for other in bank["order"]:
                        on = bank["nodes"][other]
                        if on["contracts"] and node_status(bank, st, other) == "available" and not open_contracts(st, on):
                            self._master(st, other, today)
                            settle = True
            st["cursor"] = {"key": key, "date": today}
            self.save(st)
        say = f"{c['title']}: done. Plus {c['xp']} XP."
        if not ver:
            say += " Logged on your word; add a link later to verify it."
        if mastered:
            say += f" That masters {bank['nodes'][nid]['name']}: plus 50 XP."
        elif queued == "locked":
            say += f" {bank['nodes'][nid]['name']} stays locked until its prerequisites are mastered; the contract counts."
        elif queued == "cap":
            say += f" {bank['nodes'][nid]['name']} waits in the queue: {st['wip_cap']} things are in progress already."
        return {"ok": True, "contract": {**c, "done": True, "verified": ver}, "event": ev, "mastered": mastered, "queued": queued,
                "xp": st["xp"], "say": say}

    def _master(self, st: dict, nid: str, today: str) -> str:
        rec = st["nodes"].setdefault(nid, {})
        rec["status"] = "mastered"
        rec["mastered"] = today
        st["xp"] += 50
        self._event(st, today, "node", node=nid, note="mastered", xp=50)
        return nid

    def start_node(self, nid: str, today: Optional[str] = None) -> dict:
        today = today or date.today().isoformat()
        with self._lock:
            bank = self.bank()
            if nid not in bank["nodes"]:
                raise KeyError(nid)
            st = self.load(today)
            s = node_status(bank, st, nid)
            name = bank["nodes"][nid]["name"]
            if s == "locked":
                missing = [bank["nodes"][p]["name"] for p in bank["nodes"][nid]["prereqs"] if node_status(bank, st, p) != "mastered"]
                return {"ok": False, "say": f"{name} opens after: {', '.join(missing)}."}
            if s in ("in_progress", "mastered"):
                return {"ok": True, "say": f"{name} is already {s.replace('_', ' ')}."}
            open_now = wip(bank, st)
            if len(open_now) >= st["wip_cap"]:
                names = ", ".join(bank["nodes"][x]["name"] for x in open_now)
                return {"ok": False, "cap": True, "say": f"{len(open_now)} things are in progress already ({names}). Finishing one first is how they get finished, or pause one."}
            st["nodes"].setdefault(nid, {}).update(status="in_progress", started=today, last=today)
            self._event(st, today, "node", node=nid, note="started")
            self.save(st)
        return {"ok": True, "say": f"Started {name}."}

    def pause_node(self, nid: str, today: Optional[str] = None) -> dict:
        """Take a node off the in-progress list (its finished contracts stay) to make room."""
        today = today or date.today().isoformat()
        with self._lock:
            st = self.load(today)
            rec = st["nodes"].get(nid)
            if not rec or rec.get("status") != "in_progress":
                return {"ok": False, "say": "That node isn't in progress."}
            rec["status"] = "paused"
            self._event(st, today, "node", node=nid, note="paused")
            st["days"].pop(today, None)
            self.save(st)
        return {"ok": True, "say": "Paused. Its finished contracts stay finished."}

    def master_node(self, nid: str, today: Optional[str] = None) -> dict:
        today = today or date.today().isoformat()
        with self._lock:
            bank = self.bank()
            if nid not in bank["nodes"]:
                raise KeyError(nid)
            st = self.load(today)
            s = node_status(bank, st, nid)
            if s == "locked":
                return {"ok": False, "say": "Its prerequisites aren't mastered yet."}
            if s == "mastered":
                return {"ok": True, "say": "Already mastered."}
            self._master(st, nid, today)
            self.save(st)
        return {"ok": True, "say": f"{bank['nodes'][nid]['name']} mastered. Plus 50 XP."}

    def add_attribute(self, nid: str, kind: str, text: str, url: str = "", cert: Optional[str] = None, today: Optional[str] = None) -> dict:
        """A node's attributes: certificates earned, projects shipped, achievements,
        each with its LinkedIn / GitHub link."""
        today = today or date.today().isoformat()
        if kind not in ("cert", "project", "achievement"):
            raise ValueError("kind must be cert, project or achievement")
        if url and not re.match(r"^https?://", url):
            raise ValueError("links must start with http(s)://")
        with self._lock:
            bank = self.bank()
            if nid not in bank["nodes"]:
                raise KeyError(nid)
            st = self.load(today)
            rec = st["nodes"].setdefault(nid, {})
            attrs = rec.setdefault("attributes", {})
            xp = {"cert": 150, "project": 200, "achievement": 30}[kind]
            item = {"text": (text or "")[:160], "url": url[:400], "at": today}
            if kind == "cert":
                item["cert"] = cert
                if cert:
                    st["certs"][cert] = {"earned": today, "url": url[:400], "node": nid}
            attrs.setdefault({"cert": "certs", "project": "projects", "achievement": "achievements"}[kind], []).append(item)
            st["xp"] += xp
            self._event(st, today, kind, node=nid, xp=xp, note=(text or "")[:80], verified=bool(url))
            self.save(st)
        return {"ok": True, "xp": xp, "say": f"Added to {bank['nodes'][nid]['name']}. Plus {xp} XP."}

    def log(self, minutes: int, track: str, note: str = "", proof: str = "", node: Optional[str] = None,
            today: Optional[str] = None, via: str = "ui") -> dict:
        """The one log: time + an optional proof. XP: 10 per half hour, at most 60 (5 for a short one)."""
        today = today or date.today().isoformat()
        minutes = max(1, min(600, int(minutes)))
        xp = min(60, 10 * (minutes // 30)) or 5
        track = re.sub(r"[^a-z]", "", (track or "").lower())[:16] or "silicon"
        with self._lock:
            bank = self.bank()
            st = self.load(today)
            nid = node if node in bank["nodes"] else None
            if nid:
                st["nodes"].setdefault(nid, {})["last"] = today
            ev = self._event(st, today, "log", minutes=minutes, track=track, rep=rep_for(track), note=(note or "")[:200],
                             proof=(proof or "")[:400], node=nid, xp=xp, verified=bool(re.match(r"^https?://", proof or "")), via=via)
            st["xp"] += xp
            self.save(st)
        return {"ok": True, "event": ev, "xp": st["xp"], "say": f"Logged {minutes} minutes of {track}. Plus {xp} XP."}

    def add_xp(self, amount: int, reason: str, today: Optional[str] = None) -> dict:
        """XP from the parts of the game that run in the window (Crucible, Drill,
        Forge, the Floor...). One total, one writer: this."""
        today = today or date.today().isoformat()
        amount = max(-500, min(2000, int(amount)))
        with self._lock:
            st = self.load(today)
            st["xp"] = max(0, st["xp"] + amount)
            self._event(st, today, "xp", xp=amount, note=(reason or "")[:60])
            self.save(st)
            return {"ok": True, "xp": st["xp"]}

    def set_career(self, career: Optional[str]) -> dict:
        with self._lock:
            bank = self.bank()
            if career is not None and career not in {c["id"] for c in bank["careers"]}:
                raise KeyError(career)
            st = self.load()
            st["career"] = career
            st["days"].pop(date.today().isoformat(), None)
            self.save(st)
        return {"ok": True}

    def set_settings(self, rotation: Optional[dict] = None, schedule: Optional[dict] = None,
                     window_days: Optional[int] = None, budget: Optional[dict] = None) -> dict:
        # These values arrive from the app/API.  Reject a wrong JSON shape here so
        # it becomes a useful 400 response rather than an AttributeError in the
        # plan worker (and so callers of Plan get the same contract as the route).
        for name, value in (("rotation", rotation), ("schedule", schedule), ("budget", budget)):
            if value is not None and not isinstance(value, dict):
                raise ValueError(f"{name} must be an object")
        if window_days is not None:
            try:
                window_days = int(window_days)
            except (TypeError, ValueError):
                raise ValueError("window_days must be a number")
        with self._lock:
            st = self.load()
            for k, v in (rotation or {}).items():
                if k in {"1", "2", "3", "4", "5"} and isinstance(v, dict) and v.get("track"):
                    st["rotation"][k] = {"track": str(v["track"])[:24], "label": str(v.get("label") or v["track"])[:48],
                                         "match": [str(x)[:24] for x in _as_list(v.get("match"))][:12]}
            for k, v in (schedule or {}).items():
                if k in st["schedule"] and isinstance(v, dict):
                    cur = dict(st["schedule"][k])
                    if re.fullmatch(r"\d{2}:\d{2}", str(v.get("start", ""))):
                        cur["start"] = v["start"]
                    if _num(v.get("minutes")) is not None and 15 <= v["minutes"] <= 480:
                        cur["minutes"] = int(v["minutes"])
                    st["schedule"][k] = cur
            if window_days is not None:
                st["exam"]["window_days"] = max(1, min(60, window_days))
            for k, v in (budget or {}).items():
                if k in DEFAULT_BUDGET and _num(v) is not None and 0 <= v <= 200_000:
                    st["budget"][k] = int(v)
            st["days"].pop(date.today().isoformat(), None)     # today's plan follows the new settings
            self.save(st)
            return {"ok": True, "rotation": st["rotation"], "schedule": st["schedule"], "exam": st["exam"], "budget": st["budget"]}

    def exam_focus(self, subject: Optional[str], days: int = 14, today: Optional[str] = None) -> dict:
        today = today or date.today().isoformat()
        try:
            days = max(1, min(60, int(days)))
        except (TypeError, ValueError):
            raise ValueError("days must be a number")
        with self._lock:
            ac = self.academics()
            st = self.load(today)
            if subject is None:
                st["exam"]["focus"] = None
                st["days"].pop(today, None)
                self.save(st)
                return {"ok": True, "say": "Exam mode off. Back to the rotation."}
            if not ac:
                return {"ok": False, "say": "I don't have your academics file yet, so I can't build exam contracts."}
            s = match_subject(ac, subject)
            if not s:
                return {"ok": False, "say": f"No subject like \"{subject}\". I have: {', '.join(x['name'] for x in ac['subjects'])}."}
            st["exam"]["focus"] = {"subject": s["id"], "until": (_day(today) + timedelta(days=days)).isoformat()}
            st["days"].pop(today, None)
            self.save(st)
        return {"ok": True, "subject": s["id"], "say": f"Exam mode on for {s['name']}: the library block is its highest-weight units and past papers."}

    # ---- campaigns
    def campaigns(self, today: Optional[str] = None) -> dict:
        """A campaign is a multi-week arc to a career milestone: a node with a
        project, everything it needs, a finish line (the deliverable) and a ship
        step (GitHub + the LinkedIn line, and its certificate if it has one)."""
        today = today or date.today().isoformat()
        bank = self.bank()
        st = self.load(today)
        sts = statuses(bank, st)
        out = []
        for nid in bank["order"]:
            node = bank["nodes"][nid]
            if not node["project"]:
                continue
            cid = f"camp/{nid}"
            cs = st["campaigns"].get(cid) or {}
            path = prereq_closure(bank, nid)
            left = [p for p in path if sts[p] != "mastered"]
            hours = sum(bank["nodes"][p]["hours_est"] for p in left)
            ship = ["Push the repo to GitHub with a README (and a waveform or result screenshot)",
                    f"Post on LinkedIn: \"{node['project']['linkedin_line']}\"" if node["project"]["linkedin_line"] else "Post it on LinkedIn"]
            for c in node["certs"]:
                if c in bank["certs"]:
                    ship.append(f"Earn {bank['certs'][c]['name']}")
            out.append({"id": cid, "node_id": nid, "title": node["project"]["title"], "finish_line": node["project"]["deliverable"],
                        "linkedin_line": node["project"]["linkedin_line"], "ship_steps": ship,
                        "path": [{"id": p, "name": bank["nodes"][p]["name"], "status": sts[p]} for p in path],
                        "left": len(left), "hours_left": hours, "weeks": max(1, round(hours / 6)) if hours else 0,
                        "weight": round(career_weight(bank, st, nid), 2), "status": cs.get("status") or "suggested",
                        "started": cs.get("started"), "shipped": cs.get("shipped"), "url": cs.get("url"),
                        "ready_to_ship": all(sts[p] == "mastered" for p in path if p != nid)})
        rank = {"active": 0, "suggested": 1, "shipped": 2, "dropped": 3}
        out.sort(key=lambda c: (rank.get(c["status"], 4), -c["weight"], c["hours_left"]))
        return {"campaigns": out, "active": sum(1 for c in out if c["status"] == "active"), "cap": st["wip_cap"]}

    def campaign(self, cid: str, action: str, url: str = "", today: Optional[str] = None) -> dict:
        today = today or date.today().isoformat()
        with self._lock:
            bank = self.bank()
            nid = cid.split("/", 1)[-1]
            if nid not in bank["nodes"] or not bank["nodes"][nid]["project"]:
                raise KeyError(cid)
            st = self.load(today)
            title = bank["nodes"][nid]["project"]["title"]
            cs = dict(st["campaigns"].get(cid) or {})
            if action == "start":
                active = [k for k, v in st["campaigns"].items() if v.get("status") == "active" and k != cid]
                if len(active) >= st["wip_cap"]:
                    return {"ok": False, "cap": True, "say": f"{len(active)} campaigns are running. Ship or drop one first: one finished arc beats three half ones."}
                cs.update(status="active", started=today)
                say = f"Campaign on: {title}. Its nodes now come first in your contracts."
            elif action == "ship":
                if url and not re.match(r"^https?://", url):
                    raise ValueError("the ship link must start with http(s)://")
                cs.update(status="shipped", shipped=today, url=url[:400])
                attrs = st["nodes"].setdefault(nid, {}).setdefault("attributes", {})
                attrs.setdefault("projects", []).append({"text": title, "url": url[:400], "at": today})
                st["xp"] += 300
                self._event(st, today, "ship", node=nid, xp=300, note=title, verified=bool(url))
                say = f"Shipped: {title}. Plus 300 XP. Post the LinkedIn line while it's fresh."
            elif action == "drop":
                cs.update(status="dropped")
                say = "Dropped. It stays on the Road if you want it back."
            else:
                raise ValueError("action must be start, ship or drop")
            st["campaigns"][cid] = cs
            st["days"].pop(today, None)
            self.save(st)
        return {"ok": True, "say": say}

    def earn_cert(self, cert: str, url: str = "", today: Optional[str] = None) -> dict:
        today = today or date.today().isoformat()
        bank = self.bank()
        c = bank["certs"].get(cert)
        if c is None:
            raise KeyError(cert)
        if c["node_ids"]:
            return self.add_attribute(c["node_ids"][0], "cert", c["name"], url, cert=cert, today=today)
        if url and not re.match(r"^https?://", url):
            raise ValueError("links must start with http(s)://")
        with self._lock:
            st = self.load(today)
            st["certs"][cert] = {"earned": today, "url": url[:400], "node": None}
            st["xp"] += 150
            self._event(st, today, "cert", xp=150, note=c["name"][:80], verified=bool(url))
            self.save(st)
        return {"ok": True, "xp": 150, "say": f"{c['name']} earned. Plus 150 XP."}

    def certs(self) -> dict:
        """Every certificate with its cost against the monthly budget."""
        bank = self.bank()
        st = self.load()
        b = st["budget"]
        out = []
        for c in bank["certs"].values():
            cost = c["cost_inr"]
            cred = c["credibility"]
            high = (isinstance(cred, (int, float)) and cred >= 4) or (isinstance(cred, str) and cred.lower() in ("high", "very high"))
            fit = "free" if not cost else "in budget" if cost <= b["cert_inr_month"] else \
                  "stretch" if cost <= b["cert_stretch_inr"] and high else "over budget"
            out.append({**c, "earned": st["certs"].get(c["id"]), "budget_fit": fit})
        out.sort(key=lambda c: (bool(c["earned"]), {"free": 0, "in budget": 1, "stretch": 2, "over budget": 3}[c["budget_fit"]], c["cost_inr"] or 0))
        return {"certs": out, "budget": b}

    # ---- parking lot
    def park(self, text: str, node: Optional[str] = None, today: Optional[str] = None) -> dict:
        """New ideas go here instead of into the plan: written down, so they stop
        pulling at today's contract."""
        today = today or date.today().isoformat()
        text = " ".join((text or "").split())[:240]
        if not text:
            raise ValueError("an empty idea")
        with self._lock:
            st = self.load(today)
            st["seq"] = int(st.get("seq") or 0) + 1
            st["parking"].append({"id": f"p{st['seq']}", "text": text, "at": today, "node": node})
            st["parking"] = st["parking"][-200:]
            self.save(st)
        return {"ok": True, "say": "Parked. It's safe on the list. Back to today's contract."}

    def unpark(self, pid: str) -> dict:
        with self._lock:
            st = self.load()
            st["parking"] = [p for p in st["parking"] if p["id"] != pid]
            self.save(st)
        return {"ok": True}

    # ---- state for the UI
    def state(self, today: Optional[str] = None) -> dict:
        today = today or date.today().isoformat()
        bank = self.bank()
        st = self.load(today)
        return {"xp": st["xp"], "level": level_info(st["xp"]), "career": st["career"], "statuses": statuses(bank, st),
                "nodes": st["nodes"], "contracts": st["contracts"], "events": st["events"][-300:], "rotation": st["rotation"],
                "schedule": st["schedule"], "exam": st["exam"], "parking": st["parking"], "campaigns": st["campaigns"],
                "wip": wip(bank, st), "wip_cap": st["wip_cap"], "resume": st["resume"], "budget": st["budget"],
                "certs": st["certs"], "xp_migrated_from": st["xp_migrated_from"],
                "bank": {"files": bank["files"], "warnings": bank["warnings"], "errors": bank["errors"], "nodes": len(bank["order"])}}

    def next_node(self, today: Optional[str] = None) -> Optional[dict]:
        """What's next on the tree: the in-progress node to resume, else the best
        available one (if the cap has room), else any available one."""
        today = today or date.today().isoformat()
        bank = self.bank()
        st = self.load(today)
        room = st["wip_cap"] - len(wip(bank, st))
        for _, n in rank_nodes(bank, st, None, today):
            if room > 0 or node_status(bank, st, n["id"]) == "in_progress":
                return n
        avail = [bank["nodes"][n] for n in bank["order"] if node_status(bank, st, n) == "available"]
        return avail[0] if avail else None

    # ---- Well Wisher: the Status window and quest lines (rules in wellwisher.py)
    def status(self, today: Optional[str] = None) -> dict:
        """The Status window: rank, stats with how each was computed, advice. Read only."""
        today = today or date.today().isoformat()
        bank = self.bank()
        st = self.load(today)
        return wellwisher.status_window(bank, st, today, wellwisher.load_questlines(), level_info(st["xp"]))

    def engines(self, today: Optional[str] = None, inputs: Optional[dict] = None) -> dict:
        """The Well Wisher engines over his data (ww_engines.py): the goal ladder ranks
        today's offered contracts by the rung they serve; the evidence engine audits
        every event's XP. Read only (today() may freeze the day, as GET /today does)."""
        today = today or date.today().isoformat()
        inputs = inputs if inputs is not None else ww_engines.load_inputs()
        t = self.today(today)
        st = self.load(today)
        ladder = ww_engines.goal_ladder(inputs, today, candidates=t["contracts"] + t.get("alternatives", []), done=set(st["contracts"]))
        ev = ww_engines.evidence(inputs, today, ww_engines.actions_from_plan(st))
        out = {name: self.engine(name, today, inputs) for name in ("career", "money", "personality", "insight")}
        return {"date": today, "source": inputs.get("source"), "warnings": inputs.get("warnings", []), "ladder": ladder,
                "evidence": {"xp": ev["xp"], "actions": len(ev["ledger"]), "rejected": ev["rejected"][-20:], "rules": ev["rules"]},
                **out, "three": t.get("three"),
                "registry": [{"name": d["name"], "version": d["version"], "about": d["about"]} for d in ww_engines.describe()],
                "engines": {k: (out[k]["status"] if k in out else "ok" if k in ("goal_ladder", "evidence") else f(inputs, today)["status"])
                            for k, f in ww_engines.ENGINES.items()}}

    def engine(self, name: str, today: Optional[str] = None, inputs: Optional[dict] = None) -> dict:
        """One engine by name over his data, through ww_engines.run (schema checked). Read only."""
        today = today or date.today().isoformat()
        if name not in ww_engines.REGISTRY:
            raise KeyError(f"no engine {name}")
        inputs = inputs if inputs is not None else ww_engines.load_inputs()
        bank = self.bank()
        st = self.load(today)
        try:
            av = self.apps.view(today, bank, st)
        except Exception:
            av = None
        d = ww_data(bank, st, today, av)
        day = st["days"].get(today) or {}
        args = {"goal_ladder": {"candidates": day.get("contracts") or []},
                "evidence": {"actions": ww_engines.actions_from_plan(st)},
                "career": {"nodes": d["nodes"], "applications": d["applications"]},
                "money": {"entries": d["money"]},
                "personality": {"contracts": day.get("contracts") or [], "open_projects": d["open_projects"], "active_days": d["active_days"]},
                "insight": {"events": d["events"], "planned": d["planned"], "nodes": d["nodes"]}}.get(name, {})
        if name == "learning":
            bank_ = learn_bank.load()
            out = ww_engines.run(name, inputs, today, concepts=bank_["concepts"], record=st.get("learn") or {})
            return {**out, "source": bank_["source"]}
        if name == "proof":
            # The only engine whose data comes off the network; github_activity caches it for 30 min.
            user = (inputs.get("profile") or {}).get("github")
            gh = github_activity.days(user) if user else {"days": [], "fetched": None}
            args = {"days": gh["days"], "user": user, "fetched": gh.get("fetched")}
            out = ww_engines.run(name, inputs, today, **args)
            return {**out, "error": gh.get("error"), "source": inputs.get("source")}
        return {**ww_engines.run(name, inputs, today, **args), "source": inputs.get("source")}

    def weekly(self, today: Optional[str] = None) -> dict:
        """The weekly review (insight engine); `say` is what JARVIS reads out."""
        return self.engine("insight", today)

    def learn_mark(self, concept_id: str, op: str, ok: Optional[bool] = None, today: Optional[str] = None) -> dict:
        """The daily knowledge program: op "seen" marks today's new concept as taught;
        op "recall" records a recall answer (ok true/false) for the Leitner schedule.
        Only concept ids that exist in the bank are accepted."""
        today = today or date.today().isoformat()
        ids = {c["id"] for c in learn_bank.load()["concepts"]}
        if concept_id not in ids:
            raise ValueError("no such concept")
        if op not in ("seen", "recall"):
            raise ValueError("op is seen or recall")
        if op == "recall" and not isinstance(ok, bool):
            raise ValueError("a recall needs ok: true or false")
        with self._lock:
            st = self.load(today)
            rec = st.setdefault("learn", {"seen": {}, "reviews": {}})
            if op == "seen":
                rec["seen"].setdefault(concept_id, today)
            else:
                if concept_id not in rec["seen"]:
                    raise ValueError("a concept is recalled only after it was taught")
                revs = rec["reviews"].setdefault(concept_id, [])
                revs[:] = [r for r in revs if r["date"] != today]   # one answer per day counts; a retry replaces it
                revs.append({"date": today, "ok": ok})
                revs[:] = revs[-50:]
            self.save(st)
        return self.engine("learning", today)

    def money_log(self, entry: dict, today: Optional[str] = None) -> dict:
        """One money-log entry: {kind, amount, date?, hours?, experiment?, note?}. Private,
        in the plan state; the money engine reads it. Education only, nothing is advised."""
        today = today or date.today().isoformat()
        if not isinstance(entry, dict):
            raise ValueError("an entry is an object")
        kind = str(entry.get("kind") or "")
        if kind not in ww_money.KINDS:
            raise ValueError(f"kind must be one of {', '.join(ww_money.KINDS)}")
        amount = _num(entry.get("amount"))
        if amount is None or not 0 <= amount <= 1e9:
            raise ValueError("amount must be a number from 0 up")
        d = str(entry.get("date") or today)
        if _date_or_none(d) is None or d > today:
            raise ValueError("date must be a YYYY-MM-DD day, today or earlier")
        rec = {"date": d, "kind": kind, "amount": round(float(amount), 2)}
        if entry.get("hours") not in (None, ""):
            h = _num(entry.get("hours"))
            if h is None or not 0 <= h <= 1000:
                raise ValueError("hours must be a number from 0 to 1000")
            rec["hours"] = round(float(h), 2)
        if kind == "experiment":
            xid = re.sub(r"[^\w.\-]", "-", str(entry.get("experiment") or ""))[:60]
            if not xid:
                raise ValueError("an experiment entry names its experiment")
            rec["experiment"] = xid
        if entry.get("note"):
            rec["note"] = str(entry["note"])[:200]
        with self._lock:
            st = self.load(today)
            m = st.setdefault("money", {"entries": [], "seq": 0})
            m["seq"] = int(m.get("seq") or 0) + 1
            rec["id"] = f"m{m['seq']}"
            m.setdefault("entries", []).append(rec)
            m["entries"] = m["entries"][-5000:]
            self.save(st)
        return {"ok": True, "entry": rec, "say": f"Logged {kind}: {ww_base.inr(rec['amount'])}"
                + (f" for {rec['hours']:g} h" if "hours" in rec else "") + "."}

    def money_remove(self, eid: str, today: Optional[str] = None) -> dict:
        with self._lock:
            st = self.load(today)
            ents = (st.get("money") or {}).get("entries") or []
            if not any(e.get("id") == eid for e in ents):
                raise KeyError(eid)
            st["money"]["entries"] = [e for e in ents if e.get("id") != eid]
            self.save(st)
        return {"ok": True}

    def quests(self, today: Optional[str] = None) -> dict:
        today = today or date.today().isoformat()
        lines = wellwisher.load_questlines()
        st = self.load(today)
        out = []
        for lid in lines["order"]:
            line = lines["lines"][lid]
            # a copy: reading the lines never writes a record
            view = wellwisher.quest_record({"quests": {lid: json.loads(json.dumps((st.get("quests") or {}).get(lid) or {}))}}, line)
            out.append({**line, "record": view, "today": wellwisher.quest_contract(line, view, st, today) if view["on"] else None})
        return {"lines": out, "warnings": lines["warnings"]}

    def quest_set(self, lid: str, on: bool, levels: Optional[dict] = None, today: Optional[str] = None) -> dict:
        """Turn a quest line on or off (optional by design), with an optional placement."""
        today = today or date.today().isoformat()
        if levels is not None and not isinstance(levels, dict):
            raise ValueError("levels must be an object {track: level}")
        line = wellwisher.load_questlines()["lines"].get(lid)
        if line is None:
            raise KeyError(f"no quest line {lid}")
        with self._lock:
            st = self.load(today)
            wellwisher.set_line(st, line, on, levels, today)
            self.save(st)
        return {"ok": True, "say": f"{line['name']} is {'on: one short session a day' if on else 'off'}."}

    def quest_log(self, lid: str, track: str, sets: Any, proof: str = "", today: Optional[str] = None, via: str = "ui") -> dict:
        """One logged session: finishes today's quest contract for that track (its XP
        is the session XP) and moves the level only by the two-day proof rule."""
        today = today or date.today().isoformat()
        sets = wellwisher.clean_sets(sets)
        line = wellwisher.load_questlines()["lines"].get(lid)
        if line is None:
            raise KeyError(f"no quest line {lid}")
        with self._lock:
            st = self.load(today)
            if not ((st.get("quests") or {}).get(lid) or {}).get("on"):
                raise ValueError(f"{line['name']} is off; turn it on first")
            t = wellwisher._track(line, track)
            if t is None:
                raise KeyError(f"no track {track} on {lid}")
            key = f"quest/{lid}/{track}/{today}"
            first = key not in st["contracts"]
            if first:                                 # the session finishes today's contract (its XP, its minutes)
                self.complete(key, proof, today=today, via=via)
                st = self.load(today)
            rec = wellwisher.quest_record(st, line)
            r = wellwisher.record_session(line, rec, track, sets, today)
            self._event(st, today, "quest", line=lid, track=track, level=r["level_before"], sets=sets, met=r["met"], xp=0,
                        verified=bool(re.match(r"^https?://", (proof or "").strip())), rep=rep_for(line["domain"]), via=via)
            if r["ranked_up"]:
                st["xp"] += line["rank_up_xp"]
                self._event(st, today, "rankup", line=lid, track=track, level=r["level_after"], xp=line["rank_up_xp"],
                            note=f"{t['name']} level {r['level_after']}")
            self.save(st)
        std = r["standard"]
        unit = "s" if std["unit"] == "seconds" else " reps"
        if r["ranked_up"]:
            say = (f"{t['name']} level {r['level_after']} unlocked: the standard held on {line['sessions_to_rank']} days. "
                   f"Plus {line['rank_up_xp']} XP.")
        elif r["met"] and not r["top"]:
            left = line["sessions_to_rank"] - len(r["hits"])
            say = f"Standard met ({std['sets']} x {std['target']}{unit}). {left} more day{'s' if left != 1 else ''} at it unlocks the next level."
        elif r["met"]:
            say = f"Top level held: {std['sets']} x {std['target']}{unit}."
        else:
            say = (f"Logged. The standard is {std['sets']} x {std['target']}{unit}; the level stays until it is met "
                   f"on {line['sessions_to_rank']} different days.")
        if first:
            say += f" Session: plus {line['session_xp']} XP."
        return {"ok": True, **r, "xp": st["xp"], "say": say}


# ------------------------------------------------------------------ voice lines
def _pretty(d: str) -> str:
    x = _day(d)
    return f"{x:%A} {x.day} {x:%B}"


def ww_data(bank: dict, st: dict, today: str, apps_view: Optional[dict] = None) -> dict:
    """What the Well Wisher engines read from the plan, gathered in one place (pure):
    node statuses, the pipeline, open projects (active campaigns), days with a logged
    action (events + the archive), the events, what each day planned, the money log."""
    sts = statuses(bank, st)
    days = {d for d in (st.get("archive") or {}).get("days") or []}
    days |= {e["date"] for e in st["events"] if e.get("kind") in wellwisher.ACTION_KINDS and e.get("date")}
    return {"nodes": [{"id": n, "name": bank["nodes"][n]["name"], "status": sts[n], "branch": bank["nodes"][n]["branch"],
                       "prereqs": list(bank["nodes"][n]["prereqs"])} for n in bank["order"]],
            "applications": list((apps_view or {}).get("applications") or []),
            "open_projects": [{"id": cid, "title": (((bank["nodes"].get(cid.split("/", 1)[-1]) or {}).get("project") or {}).get("title")
                                                    or cid.split("/", 1)[-1])} for cid, cs in sorted(st["campaigns"].items())
                              if (cs or {}).get("status") == "active"],
            "active_days": sorted(d for d in days if d <= today),
            "events": [e for e in st["events"] if e.get("date")],
            "planned": {d: [c["key"] for c in day.get("contracts") or [] if c.get("key")] for d, day in st["days"].items()},
            "money": list((st.get("money") or {}).get("entries") or [])}


def _say_contract(c: dict) -> str:
    return f"{c['title']}, {c['minutes']} minutes" + (f", on {c['node_name']}" if c.get("node_name") and c["node_name"] not in c["title"] else "")


def voice(plan: Plan, intent: str, args: dict, today: Optional[str] = None, brief: Optional[dict] = None) -> dict:
    """The voice intents, answered in one spoken line, window or no window."""
    today = today or date.today().isoformat()
    d = plan.today(today)
    open_c = [c for c in d["contracts"] if not c["done"]]

    def current() -> Optional[dict]:
        cur = d.get("cursor") or {}
        if cur.get("date") == today:
            hit = next((c for c in open_c if c["key"] == cur.get("key")), None)
            if hit:
                return hit
        return open_c[0] if open_c else None

    def point(c: dict) -> None:
        with plan._lock:
            st = plan.load(today)
            st["cursor"] = {"key": c["key"], "date": today}
            plan.save(st)

    if intent == "today":
        if not d["bank_ready"] and not d["exam"] and not d["contracts"]:
            return {"ok": False, "say": "The skill-tree bank hasn't landed yet, so there are no contracts to give you."}
        parts = []
        if d.get("welcome_back"):
            parts.append(d["welcome_back"]["say"])
        if d["exam"]:
            e = d["exam"]
            if e.get("phase"):
                if e["phase"].get("anchor_assumed"):        # counting down to a date that isn't confirmed
                    parts.append(f"Exam plan: {e['phase']['name']}, probably about {e['phase']['days_left']} days to go; the date isn't confirmed.")
                else:
                    parts.append(f"Exam plan: {e['phase']['name']}, {e['phase']['days_left']} days to go.")
            elif e.get("subject"):
                parts.append(f"Exam mode: {e['subject']['name']}" + (f", {e['days_left']} days left." if e["days_left"] is not None else "."))
        elif d.get("track_label"):
            parts.append(f"{d['track_label']} day.")
        if open_c:
            c = open_c[0]
            point(c)
            parts.append(f"First: {_say_contract(c)}.")
            if len(open_c) > 1:
                parts.append("Then " + "; ".join(x["title"] for x in open_c[1:3]) + ".")
        else:
            parts.append("Everything on today's list is done. Good day." if d["contracts"] else "Nothing scheduled today.")
        w = d["wins"]
        if w["contracts"]:
            parts.append(f"Already done today: {w['contracts']} contract{'s' if w['contracts'] != 1 else ''}.")
        data = (brief or {}).get("data") if isinstance(brief, dict) else None
        if isinstance(data, dict) and not data.get("secured") and isinstance(data.get("floor"), dict):
            todo = [k.capitalize() for k, v in data["floor"].items() if not v]
            if todo:
                parts.append(f"Floor still open: {', '.join(todo)}.")
        return {"ok": True, "say": " ".join(parts)}

    if intent == "explain":
        c = current()
        if not c:
            return {"ok": False, "say": "No open contract to explain. Ask me what's next on the tree."}
        point(c)
        bits = [f"{c['title']}."]
        if c.get("context"):
            bits.append(c["context"])
        if c.get("read_first"):
            bits.append("Read first: " + "; ".join(r["title"] for r in c["read_first"][:2]) + ".")
        if c.get("steps"):
            bits.append("Steps: " + "; ".join(c["steps"][:4]) + ".")
        if c.get("hint"):
            bits.append(f"Hint: {c['hint']}")
        if c.get("success_check"):
            bits.append(f"You're done when: {c['success_check']}")
        return {"ok": True, "say": " ".join(bits), "contract": c["key"]}

    if intent == "finish":
        q = str(args.get("query") or "").strip()
        target = None
        if q:
            scored = sorted(((word_score(q, c["title"] + " " + (c.get("node_name") or "")), i, c) for i, c in enumerate(open_c)),
                            key=lambda x: (-x[0], x[1]))
            if scored and scored[0][0] >= 0.5:
                target = scored[0][2]
        if target is None:
            target = current()
        if target is None:
            return {"ok": False, "say": "Nothing open today to finish. That's a clean sheet."}
        r = plan.complete(target["key"], proof=f"Voice: \"{str(args.get('utterance') or q)[:200]}\"", verified=False, today=today, via="voice")
        nxt = [c for c in plan.today(today)["contracts"] if not c["done"]]
        say = r["say"] + (f" Next: {nxt[0]['title']}." if nxt else " That's today's list done.")
        return {"ok": r["ok"], "say": say}

    if intent == "next_node":
        n = plan.next_node(today)
        if not n:
            return {"ok": False, "say": "The tree is empty right now: the bank hasn't landed." if not d["bank_ready"]
                    else "Nothing is open: finish an in-progress node to unlock the next."}
        st = plan.load(today)
        started = node_status(plan.bank(), st, n["id"]) == "in_progress"
        first = open_contracts(st, n)
        return {"ok": True, "say": f"Next on the tree: {n['name']}{', which you already started' if started else ''}."
                + (f" Its first contract: {first[0]['title']}, {first[0]['minutes']} minutes." if first else "")}

    if intent == "exam_mode":
        subj = args.get("subject")
        return plan.exam_focus(None if subj in (None, "", "off") else str(subj), today=today)

    if intent == "days_to":
        ac = plan.academics()
        if not ac:
            return {"ok": False, "say": "I don't have your academics file yet."}
        q = str(args.get("subject") or "")
        s = match_subject(ac, q) if q else None
        if q and s is None:
            return {"ok": False, "say": f"No subject like \"{q}\"."}
        if s is None:
            dated = sorted(((next_exam(ac, x, today)[0], x) for x in ac["subjects"] if next_exam(ac, x, today)[0]), key=lambda y: y[0])
            if not dated:
                return {"ok": False, "say": "No exam dates set yet. Add them in Mission settings."}
            s = dated[0][1]
        d, kind, approx = next_exam(ac, s, today)
        if not d:
            if s["kind"] == "backlog":
                end = (ac.get("calendar") or {}).get("end_sem_start")
                return {"ok": False, "say": f"{s['name']} is a backlog and its date isn't confirmed yet"
                        + (f"; it's expected near the end-sem window, around {_day(end).day} {_day(end):%B}" if end else "")
                        + ". Tell me the date in Mission settings when you know it."}
            return {"ok": False, "say": f"{s['name']} has no exam date yet. Set it in Mission settings."}
        n = (_day(d) - _day(today)).days
        when = "today" if n == 0 else "tomorrow" if n == 1 else f"in {n} days"
        what = {"internals": "Internals for", "end-sem": "End-sem for", "backlog block": "The backlog paper for"}.get(kind, "")
        lead = f"{what} {s['name']}" if what else s["name"]
        return {"ok": True, "say": f"{lead} {'start' if kind == 'internals' else 'is'} {when}, on {_pretty(d)}"
                + (" (approximate)" if approx else "") + "."
                + (" It's a backlog, so it goes first." if s["kind"] == "backlog" else "")}

    if intent == "log":
        track = str(args.get("track") or "")
        if track not in ("deutsch", "silicon", "body"):
            return {"ok": False, "say": "Log what: German, Silicon or a workout?"}
        try:
            minutes = max(1, min(600, int(args.get("minutes") or 0)))
        except (TypeError, ValueError):
            minutes = 0
        if not minutes:
            return {"ok": False, "say": "How long? Say it with the minutes or hours."}
        r = plan.log(minutes, track, note="voice", today=today, via="voice")
        what = "a training session" if track == "body" else \
            f"{minutes // 60} hour{'s' if minutes >= 120 else ''}{f' {minutes % 60} minutes' if minutes % 60 else ''} of {'German' if track == 'deutsch' else 'Silicon'}" \
            if minutes >= 60 else f"{minutes} minutes of {'German' if track == 'deutsch' else 'Silicon'}"
        return {"ok": True, "say": f"Logged {what}. Plus {r['event']['xp']} XP." + (" The Floor ticks when the Mission window syncs." if r["event"].get("rep") else "")}

    if intent == "learning":
        text = str(args.get("text") or "").strip()
        if not text:
            return {"ok": False, "say": "Log what? Say it after \"log:\"."}
        try:
            minutes = int(args.get("minutes") or 0)
        except (TypeError, ValueError):
            minutes = 0
        return add_learning(plan, text, minutes, today=today, via="voice")

    if intent == "deadlines":
        return {"ok": True, "say": deadlines_say(plan.apps.view(today, plan.bank(), plan.load(today)))}

    if intent == "weekly_review":
        r = plan.weekly(today)
        return {"ok": r.get("status") == "ok", "say": r.get("say") or "The weekly review couldn't be built from the inputs right now."}

    if intent == "career_next":
        r = plan.engine("career", today)
        return {"ok": r.get("status") == "ok", "say": r.get("say") or "The career engine couldn't read its inputs right now."}

    if intent == "park":
        try:
            return plan.park(str(args.get("text") or ""))
        except ValueError:
            return {"ok": False, "say": "Park what? Say the idea after \"park\"."}

    return {"ok": False, "say": f"I don't know the mission intent \"{intent}\"."}


# ------------------------------------------------------------------ latest findings
ARXIV_CATS = [
    (re.compile(r"math|prob|stat|calc|linear", re.I), ["math.HO", "math.PR"]),
    (re.compile(r"\bml\b|\bdl\b|learn|\bai\b|neural|vision", re.I), ["cs.LG"]),
    (re.compile(r"signal|dsp|comm|wireless|\brf\b|csi", re.I), ["eess.SP"]),
    (re.compile(r"digital|hdl|verilog|rtl|vlsi|arch|risc|cpu|fpga|chip|logic|security|systolic", re.I), ["cs.AR"]),
]
_STOP = {"and", "the", "for", "with", "from", "into", "basics", "fundamentals", "intro", "introduction", "set", "part", "refresh"}


def cats_for(node: dict) -> list[str]:
    for rx, cats in ARXIV_CATS:
        if rx.search(node["branch"]):
            return cats
    for rx, cats in ARXIV_CATS:
        if rx.search(node["name"]):
            return cats
    return ["cs.AR"]


def arxiv_cat(terms: list[str], cats: list[str], max_results: int = 3) -> list[dict]:
    """arXiv, newest first, inside the given categories and matching any term."""
    terms = [re.sub(r"[^\w\-]", "", t)[:30] for t in terms if t][:4] or ["survey"]
    cat_q = " OR ".join(f"cat:{c}" for c in cats)
    term_q = " OR ".join(f"all:{t}" for t in terms)
    r = httpx.get("https://export.arxiv.org/api/query", timeout=15, params={
        "search_query": f"({cat_q}) AND ({term_q})", "start": 0, "max_results": max(1, min(max_results, 6)),
        "sortBy": "submittedDate", "sortOrder": "descending"})
    r.raise_for_status()
    if re.search(r"<!(DOCTYPE|ENTITY)", r.text[:4096], re.I):
        raise ValueError("unexpected XML declarations in arXiv response")
    root = ET.fromstring(r.text)
    out = []
    for e in root.findall("a:entry", ATOM):
        link = next((l.get("href") for l in e.findall("a:link", ATOM) if l.get("type") == "text/html"), None)
        out.append({"id": (e.findtext("a:id", default="", namespaces=ATOM) or "").strip(),
                    "title": " ".join((e.findtext("a:title", default="", namespaces=ATOM) or "").split()),
                    "summary": " ".join((e.findtext("a:summary", default="", namespaces=ATOM) or "").split())[:300],
                    "published": e.findtext("a:published", default="", namespaces=ATOM),
                    "url": link or (e.findtext("a:id", default="", namespaces=ATOM) or "").strip()})
    return out


def findings(plan: Plan, today: Optional[str] = None, refresh: bool = False, fetch=None, path: Optional[Path] = None) -> dict:
    """A small daily digest per active node: fetched at most once a day per node,
    cached on disk, and served stale (and labelled so) when arXiv can't be reached."""
    today = today or date.today().isoformat()
    fetch = fetch or arxiv_cat
    path = path or FINDINGS
    bank = plan.bank()
    st = plan.load(today)
    active = wip(bank, st)
    for c in (st["days"].get(today) or {}).get("contracts", []):
        if c.get("node_id") in bank["nodes"] and c["node_id"] not in active:
            active.append(c["node_id"])
    active = active[:4]
    try:
        cache = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        cache = {}
    out, changed = [], False
    for nid in active:
        node = bank["nodes"][nid]
        cats = cats_for(node)
        hit = cache.get(nid) or {}
        entry = {"node_id": nid, "name": node["name"], "cats": cats, "papers": hit.get("papers", []),
                 "fetched": hit.get("fetched"), "stale": hit.get("fetched") != today, "error": None}
        if refresh or hit.get("fetched") != today:
            terms = [w for w in re.findall(r"[A-Za-z0-9\-]+", node["name"]) if w.lower() not in _STOP and len(w) > 2]
            try:
                papers = fetch(terms, cats, 3)
                entry.update(papers=papers, fetched=today, stale=False)
                cache[nid] = {"papers": papers, "fetched": today}
                changed = True
            except Exception as e:                    # offline: keep the last digest, say so
                entry["error"] = f"offline ({type(e).__name__})"
        out.append(entry)
    if changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(cache), encoding="utf-8")
        tmp.replace(path)
    return {"date": today, "nodes": out}


# ------------------------------------------------------------------ internships + long-term goals (private)
# The summer-2027 internship hunt is a campaign of its own: a pipeline of dated
# applications. Research writes the calendar (internships.json, read only here);
# his progress lives in applications.json (statuses, notes, entries he adds). Both
# sit in data/app/germoney/, served by the server, never in the bundle.
INTERNSHIPS = ROOT / "internships.json"
APPLICATIONS = ROOT / "applications.json"
APP_STATUSES = ("idea", "preparing", "applied", "interview", "offer", "rejected", "not_eligible")
CLOSED = ("offer", "rejected", "not_eligible")
APP_FIELDS = ("org", "programme", "url", "opens", "closes", "requirements", "linked_nodes", "prep_contracts", "stipend", "notes",
              "reason", "verified")
DEFAULT_GOALS = [
    {"id": "internship-2027", "title": "Summer 2027 off-campus internship",
     "target": "₹1–2 lakh stipend, at a CV-lifting company or a funded research programme (e.g. DAAD WISE)",
     "kind": "campaign", "milestones": []},
    {"id": "one-crore", "title": "₹1 crore career", "target": "A long-term goal: each milestone links to the skill-tree nodes that earn it",
     "kind": "long_term", "milestones": []},
]


def _read_json(p: Path, dflt: Any) -> Any:
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return dflt


def _write_json(p: Path, data: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


def clean_application(a: Any, src: str = "you") -> Optional[dict]:
    if not isinstance(a, dict) or not a.get("id") or not (a.get("org") or a.get("programme")):
        return None
    out = {"id": re.sub(r"[^\w.\-]", "-", str(a["id"]))[:80], "org": str(a.get("org") or "")[:120],
           "programme": str(a.get("programme") or "")[:160], "url": str(a.get("url") or "")[:400],
           "opens": _date_or_none(a.get("opens")), "closes": _date_or_none(a.get("closes")),
           "status": a.get("status") if a.get("status") in APP_STATUSES else "idea",
           "requirements": _str_list(a.get("requirements"))[:20], "linked_nodes": _str_list(a.get("linked_nodes"))[:20],
           "prep_contracts": _str_list(a.get("prep_contracts"))[:20], "stipend": str(a.get("stipend") or "")[:80],
           "notes": str(a.get("notes") or "")[:600], "reason": str(a.get("reason") or "")[:300],
           "verified": bool(a.get("verified", src == "research")), "source": src}
    if out["url"] and not re.match(r"^https?://", out["url"]):
        out["url"] = ""
    return out


class Applications:
    """The internship pipeline and the long-term goals, one JSON file he owns."""

    def __init__(self, calendar: Optional[Path] = None, store: Optional[Path] = None):
        self.calendar = calendar or INTERNSHIPS
        self.store = store or APPLICATIONS
        self._lock = threading.Lock()

    def _state(self) -> dict:
        st = _read_json(self.store, {})
        if not isinstance(st, dict):
            st = {}
        st.setdefault("applications", {})          # id -> his entry or his overrides of a calendar entry
        st.setdefault("goals", json.loads(json.dumps(DEFAULT_GOALS)))
        st.setdefault("tasks", [])                 # the prep checklist: [{id, title, due, done, application?}]
        return st

    def all(self) -> list[dict]:
        cal = _read_json(self.calendar, [])
        if isinstance(cal, dict):
            cal = cal.get("applications") or cal.get("internships") or []
        merged: dict[str, dict] = {}
        for a in _as_list(cal):
            c = clean_application(a, "research")
            if c:
                merged[c["id"]] = c
        for aid, mine in self._state()["applications"].items():
            base = merged.get(aid, {})
            c = clean_application({**base, **mine, "id": aid}, base.get("source", "you"))
            if c:
                merged[aid] = c
        return list(merged.values())

    def view(self, today: Optional[str] = None, bank: Optional[dict] = None, plan_state: Optional[dict] = None) -> dict:
        """The pipeline: every application with its countdown, grouped by status, and
        the deadlines within 14 days (what Today and the voice surface)."""
        today = today or date.today().isoformat()
        t = _day(today)
        rows = []
        for a in self.all():
            left = (_day(a["closes"]) - t).days if a["closes"] else None
            opens_in = (_day(a["opens"]) - t).days if a["opens"] else None
            prep = []
            for cid in a["prep_contracts"]:
                nid = (bank or {}).get("contract_index", {}).get(cid)
                done = bool(plan_state and nid and f"{nid}/{cid}" in plan_state.get("contracts", {}))
                title = next((c["title"] for c in (bank or {}).get("nodes", {}).get(nid, {}).get("contracts", []) if c["id"] == cid), cid) if nid else cid
                prep.append({"id": cid, "node": nid, "title": title, "done": done})
            nodes = [{"id": n, "name": (bank or {}).get("nodes", {}).get(n, {}).get("name", n),
                      "status": node_status(bank, plan_state, n) if bank and plan_state and n in bank["nodes"] else "unknown"}
                     for n in a["linked_nodes"]]
            rows.append({**a, "days_left": left, "opens_in": opens_in, "open_now": (opens_in is None or opens_in <= 0) and (left is None or left >= 0),
                         "prep": prep, "nodes": nodes})
        active = lambda r: r["status"] not in CLOSED
        rows.sort(key=lambda r: (not active(r), r["days_left"] if r["days_left"] is not None and r["days_left"] >= 0 else 10_000, r["org"]))
        pipeline = {s: [r["id"] for r in rows if r["status"] == s] for s in APP_STATUSES}
        due = [r for r in rows if active(r) and r["status"] in ("idea", "preparing") and r["days_left"] is not None and 0 <= r["days_left"] <= 14]
        tasks = [{**x, "days_left": (_day(x["due"]) - t).days if _date_or_none(x.get("due")) else None}
                 for x in self._state()["tasks"] if isinstance(x, dict) and x.get("title")]
        tasks.sort(key=lambda x: (bool(x.get("done")), x["days_left"] if x["days_left"] is not None else 10_000))
        due_tasks = [x for x in tasks if not x.get("done") and x["days_left"] is not None and x["days_left"] <= 7]
        return {"date": today, "applications": rows, "pipeline": pipeline, "due_soon": due, "tasks": tasks, "due_tasks": due_tasks,
                "goals": self.goals(bank, plan_state)}

    def set_task(self, task: dict) -> dict:
        """Add, edit or tick a prep-checklist item (a transcript, a referee, an email batch)."""
        if not isinstance(task, dict) or not (task.get("id") or task.get("title")):
            raise ValueError("a task needs a title")
        with self._lock:
            st = self._state()
            tid = re.sub(r"[^\w.\-]", "-", str(task.get("id") or f"t{len(st['tasks']) + 1}"))[:60]
            cur = next((x for x in st["tasks"] if x.get("id") == tid), None)
            clean = {**(cur or {}), "id": tid}
            if "title" in task:
                clean["title"] = str(task["title"])[:200]
            if "due" in task:
                clean["due"] = _date_or_none(task.get("due"))
            if "done" in task:
                clean["done"] = bool(task["done"])
            if "application" in task:
                clean["application"] = str(task.get("application") or "")[:80] or None
            if not clean.get("title"):
                raise ValueError("a task needs a title")
            st["tasks"] = [x for x in st["tasks"] if x.get("id") != tid] + [clean]
            _write_json(self.store, st)
        return clean

    def upsert(self, entry: dict) -> dict:
        c = clean_application(entry)
        if c is None:
            raise ValueError("an application needs an id and an org or programme")
        with self._lock:
            st = self._state()
            mine = {k: c[k] for k in ("status",) + APP_FIELDS if k in entry}
            st["applications"][c["id"]] = {**st["applications"].get(c["id"], {}), **mine}
            _write_json(self.store, st)
        return c

    def set_status(self, aid: str, status: str, note: str = "") -> dict:
        if status not in APP_STATUSES:
            raise ValueError(f"status must be one of {', '.join(APP_STATUSES)}")
        if aid not in {a["id"] for a in self.all()}:
            raise KeyError(aid)
        with self._lock:
            st = self._state()
            rec = st["applications"].setdefault(aid, {})
            rec["status"] = status
            rec.setdefault("history", []).append({"status": status, "at": date.today().isoformat(), "note": note[:200]})
            _write_json(self.store, st)
        return {"ok": True}

    def remove(self, aid: str) -> dict:
        with self._lock:
            st = self._state()
            st["applications"].pop(aid, None)
            _write_json(self.store, st)
        return {"ok": True}

    def goals(self, bank: Optional[dict] = None, plan_state: Optional[dict] = None) -> list[dict]:
        out = []
        for gl in self._state()["goals"]:
            ms = []
            for m in _as_list(gl.get("milestones")):
                if not isinstance(m, dict):
                    continue
                nodes = _str_list(m.get("linked_nodes"))
                mastered = [n for n in nodes if bank and plan_state and n in bank["nodes"] and node_status(bank, plan_state, n) == "mastered"]
                ms.append({"id": str(m.get("id") or ""), "title": str(m.get("title") or ""), "by": _date_or_none(m.get("by")),
                           "linked_nodes": nodes, "mastered": mastered,
                           "progress": round(len(mastered) / len(nodes), 2) if nodes else (1.0 if m.get("done") else 0.0),
                           "done": bool(m.get("done")) or (bool(nodes) and len(mastered) == len(nodes))})
            out.append({"id": gl.get("id"), "title": gl.get("title"), "target": gl.get("target", ""), "kind": gl.get("kind", "long_term"), "milestones": ms})
        return out

    def set_goal(self, goal: dict) -> dict:
        if not isinstance(goal, dict) or not goal.get("id") or not goal.get("title"):
            raise ValueError("a goal needs an id and a title")
        clean = {"id": re.sub(r"[^\w.\-]", "-", str(goal["id"]))[:60], "title": str(goal["title"])[:120],
                 "target": str(goal.get("target") or "")[:300], "kind": "campaign" if goal.get("kind") == "campaign" else "long_term",
                 "milestones": [{"id": str(m.get("id") or f"m{i + 1}")[:40], "title": str(m.get("title") or "")[:160],
                                 "by": _date_or_none(m.get("by")), "linked_nodes": _str_list(m.get("linked_nodes"))[:20],
                                 "done": bool(m.get("done"))} for i, m in enumerate(_as_list(goal.get("milestones"))) if isinstance(m, dict)]}
        with self._lock:
            st = self._state()
            st["goals"] = [x for x in st["goals"] if x.get("id") != clean["id"]] + [clean]
            _write_json(self.store, st)
        return clean


def deadlines_say(view: dict) -> str:
    """'What internship deadlines are coming up', in one breath."""
    rows = [r for r in view["applications"] if r["status"] in ("idea", "preparing")
            and r["days_left"] is not None and r["days_left"] >= 0]
    if not view["applications"]:
        return "No internship applications yet. The research calendar hasn't landed; add one on the Road."
    if not rows:
        live = [r for r in view["applications"] if r["status"] in ("applied", "interview")]
        return "No open deadlines ahead." + (f" Waiting on {len(live)} application{'s' if len(live) != 1 else ''}." if live else "")
    parts = []
    for r in rows[:3]:
        when = "today" if r["days_left"] == 0 else "tomorrow" if r["days_left"] == 1 else f"in {r['days_left']} days"
        name = r["org"] or r["programme"]
        parts.append(f"{name} closes {when}")
    more = len(rows) - 3
    tasks = view.get("due_tasks") or []
    return "Internship deadlines: " + "; ".join(parts) + "." + (f" {more} more on the Road." if more > 0 else "") \
        + (f" This week: {'; '.join(x['title'] for x in tasks[:2])}." if tasks else "")


# ============================================================== the goal ladder, gaps, the profile, the learning log
# Vision (fixed, ten years) → year milestones (fixed until a monthly review moves
# them) → quarter / month / week goals (re-derived from progress every time) →
# today's contracts, each of which says which goal it serves. All private files in
# data/app/germoney/, never in the bundle.
LADDER = ROOT / "ladder.json"
PROFILE = ROOT / "profile.json"
LEARNING = ROOT / "learning"

DEFAULT_LADDER = {
    "vision": {"title": "A future-proof, high-impact career that earns well and ethically",
               "horizon": "10 years", "band": "around ₹1 crore a year"},
    "years": [
        {"year": 2027, "milestones": [
            {"id": "backlogs", "title": "Clear the backlogs", "kind": "academics", "match": ["backlog"]},
            {"id": "internship", "title": "A summer-2027 internship", "kind": "internship", "match": ["internship-2027"]},
            {"id": "rtl-portfolio", "title": "An RTL portfolio on GitHub", "kind": "tree",
             # test audit: every branch in the bank maps to a milestone (ai_hardware,
             # embedded, security and dsa served nothing before, so "why this today" was empty)
             "match": ["digital", "hdl", "verification", "implementation", "fpga", "architecture", "programming", "tools", "career",
                       "ai_hardware", "embedded", "security", "dsa"]},
            {"id": "ms-apps", "title": "MS applications in Germany", "kind": "road",
             "match": ["math", "research", "soft", "ml", "deep_learning", "analog", "devices"]},
        ]},
        {"year": 2028, "milestones": [
            {"id": "graduate", "title": "Graduate, and start the MS", "kind": "road", "match": []},
        ]},
    ],
    "reviews": [],
}

# The profile: style rules the engine and JARVIS follow. Descriptive only; the test's
# scores are never stored (he can add whatever he likes to his own file).
DEFAULT_PROFILE = {
    "traits": ["creative problem solver: open problems, variety, autonomy", "follow-through is the weak spot",
               "rigid routine drains him"],
    "style": {"novelty_first": True, "choices": 3, "sprint_minutes": 45, "wip_cap": 3, "quiet_hours": ["23:00", "08:00"],
              "nudge_after_idle_days": 3, "welcome_back_after_days": 4, "refresh_after_days": 30},
    "rules": ["Lead with the problem or puzzle; theory comes after he has tried it",
              "Offer two or three contracts to choose from, not one fixed task",
              "Short sprints with an explicit finish line",
              "At most three open campaigns; new ideas go to the parking lot",
              "Show the small wins every day",
              "Encouraging, never shaming; after a gap, say plainly what slipped and offer a small first win"],
}


def load_ladder(path: Optional[Path] = None) -> dict:
    raw = _read_json(path or LADDER, None)
    if not isinstance(raw, dict) or not isinstance(raw.get("vision"), dict):
        return json.loads(json.dumps(DEFAULT_LADDER))
    raw.setdefault("years", [])
    raw.setdefault("reviews", [])
    return raw


def load_profile(path: Optional[Path] = None) -> dict:
    raw = _read_json(path or PROFILE, None)
    d = json.loads(json.dumps(DEFAULT_PROFILE))
    if not isinstance(raw, dict):
        return d
    d.update({k: v for k, v in raw.items() if k != "style"})
    d["style"] = {**d["style"], **(raw.get("style") if isinstance(raw.get("style"), dict) else {})}
    return d


def save_profile(profile: dict, path: Optional[Path] = None) -> dict:
    if not isinstance(profile, dict):
        raise ValueError("a profile is an object")
    clean = load_profile(path)
    for k in ("traits", "rules"):
        if k in profile:
            clean[k] = _str_list(profile[k])[:20]
    if isinstance(profile.get("style"), dict):
        st = clean["style"]
        for k, v in profile["style"].items():
            if k in ("novelty_first",):
                st[k] = bool(v)
            elif k in ("choices", "sprint_minutes", "wip_cap", "nudge_after_idle_days", "welcome_back_after_days", "refresh_after_days") and _num(v) is not None:
                st[k] = int(max(1, min(240, v)))
            elif k == "quiet_hours" and isinstance(v, list) and len(v) == 2 and all(re.fullmatch(r"\d{2}:\d{2}", str(x)) for x in v):
                st[k] = [str(v[0]), str(v[1])]
    for k, v in profile.items():                     # anything else he keeps in his own file stays his
        if k not in ("traits", "rules", "style") and isinstance(k, str) and len(k) < 40:
            clean[k] = v
    _write_json(path or PROFILE, clean)
    return clean


def in_quiet_hours(now: datetime, quiet: list[str]) -> bool:
    a, b = quiet
    hm = now.strftime("%H:%M")
    return (a <= hm or hm < b) if a > b else (a <= hm < b)


def year_milestones(ladder: dict, year: int) -> list[dict]:
    for y in ladder.get("years") or []:
        if int(y.get("year") or 0) == year:
            return [m for m in _as_list(y.get("milestones")) if isinstance(m, dict) and m.get("id")]
    return []


def serves_for(c: dict, ladder: dict, today: str, ac: Optional[dict] = None, apps_nodes: Optional[set] = None) -> Optional[dict]:
    """Which ladder milestone a contract serves ('why this today')."""
    year = _day(today).year if _day(today).month < 10 else _day(today).year + 1     # an academic year: Oct → the next calendar year
    ms = year_milestones(ladder, year) or year_milestones(ladder, _day(today).year)
    if not ms:
        return None
    kind_of = {m["kind"]: m for m in ms if m.get("kind")}
    subj = next((s for s in (ac or {}).get("subjects", []) if s["id"] == c.get("subject_id")), None) if c.get("source") == "academics" else None
    if c.get("source") == "academics" or (c.get("source") == "practice" and c.get("branch") == "academics"):
        if subj is not None and subj["kind"] == "current" and "ms-apps" in {m["id"] for m in ms}:
            m = next(m for m in ms if m["id"] == "ms-apps")
            return {"id": m["id"], "title": m["title"], "why": "Sem-5 grades go on the MS application"}
        m = kind_of.get("academics")
        return {"id": m["id"], "title": m["title"], "why": "Exam plan"} if m else None
    why = (c.get("why") or "").lower()
    if (why.startswith("maths rescue") or "foundation for maths" in why) and "backlogs" in {m["id"] for m in ms}:
        m = next(m for m in ms if m["id"] == "backlogs")
        return {"id": m["id"], "title": m["title"], "why": "The maths backlog paper"}
    if c.get("node_id") and apps_nodes and c["node_id"] in apps_nodes and kind_of.get("internship"):
        m = kind_of["internship"]
        return {"id": m["id"], "title": m["title"], "why": "An internship application asks for this"}
    branch = (c.get("branch") or "").lower()
    for m in ms:
        if m.get("kind") in ("tree", "road") and any(x and x in branch for x in _str_list(m.get("match"))):
            return {"id": m["id"], "title": m["title"], "why": f"{branch.replace('_', ' ')} work builds it"}
    if c.get("node_id") and c["node_id"].startswith("math"):
        m = next((m for m in ms if m["id"] == "backlogs"), None)
        if m:
            return {"id": m["id"], "title": m["title"], "why": "Maths foundations for the backlog paper"}
    return None


def ladder_view(plan: "Plan", today: Optional[str] = None) -> dict:
    """The whole ladder: the fixed vision and years, and the quarter / month / week
    goals derived from progress right now."""
    today = today or date.today().isoformat()
    ladder = load_ladder()
    bank, ac = plan.bank(), plan.academics()
    st = plan.load(today)
    apps = plan.apps.view(today, bank, st)
    t = _day(today)
    year = t.year if t.month < 10 else t.year + 1
    q = (t.month - 1) // 3 + 1
    q_end = date(t.year, 3 * q, 1) + timedelta(days=32)
    q_end = date(q_end.year, q_end.month, 1) - timedelta(days=1)
    month_end = (date(t.year + (t.month == 12), t.month % 12 + 1, 1) - timedelta(days=1))
    week_end = t + timedelta(days=6 - t.weekday())
    quarter, month, week = [], [], []
    exam = exam_state(ac, st, today)
    backlogs = [s for s in (ac or {}).get("subjects", []) if s["kind"] == "backlog"]
    if backlogs:
        need = ", ".join(f"{s['name']} ({(s.get('pass_rule') or {}).get('see_needed_computed') or '?'} marks)" for s in backlogs)
        quarter.append({"serves": "backlogs", "title": f"Pass the backlogs: {need}"})
    for a in apps["applications"]:
        if a["status"] in ("idea", "preparing") and a["closes"] and str(t) <= a["closes"] <= str(q_end):
            quarter.append({"serves": "internship", "title": f"Apply: {a['org']} · {a['programme']} (closes {a['closes']})"})
            if a["closes"] <= str(month_end):
                month.append({"serves": "internship", "title": f"Submit {a['org']} by {a['closes']}"})
    camps = [c for c in plan.campaigns(today)["campaigns"] if c["status"] == "active"]
    for c in camps:
        quarter.append({"serves": "rtl-portfolio", "title": f"Ship the campaign: {c['title']}"})
        month.append({"serves": "rtl-portfolio", "title": f"{c['title']}: {c['left']} node(s) to go"})
    for nid in wip(bank, st):
        month.append({"serves": "rtl-portfolio", "title": f"Finish {bank['nodes'][nid]['name']}"})
    if exam and exam.get("milestone"):
        month.append({"serves": "backlogs", "title": exam["milestone"]})
    for x in apps["due_tasks"]:
        week.append({"serves": "internship", "title": x["title"]})
    day = st["days"].get(today) or {}
    for c in day.get("contracts", [])[:4]:
        week.append({"serves": (c.get("serves") or {}).get("id"), "title": c["title"]})
    return {"vision": ladder["vision"], "years": ladder["years"], "year": year,
            "quarter": {"label": f"{t.year} Q{q}", "ends": q_end.isoformat(), "goals": quarter},
            "month": {"label": t.strftime("%B %Y"), "ends": month_end.isoformat(), "goals": month},
            "week": {"ends": week_end.isoformat(), "goals": week}, "reviews": ladder["reviews"][-12:],
            "review_due": not any(r.get("month") == today[:7] for r in ladder["reviews"])}


def save_review(review: dict, today: Optional[str] = None, path: Optional[Path] = None) -> dict:
    """The monthly review: what went well, what slipped, and milestone edits (the vision stays)."""
    today = today or date.today().isoformat()
    if not isinstance(review, dict):
        raise ValueError("a review is an object")
    ladder = load_ladder(path)
    entry = {"month": str(review.get("month") or today[:7])[:7], "at": today,
             "went_well": str(review.get("went_well") or "")[:1000], "slipped": str(review.get("slipped") or "")[:1000],
             "next": str(review.get("next") or "")[:1000]}
    ladder["reviews"] = [r for r in ladder["reviews"] if r.get("month") != entry["month"]] + [entry]
    for edit in _as_list(review.get("milestones")):
        if not isinstance(edit, dict) or not edit.get("id"):
            continue
        y = next((y for y in ladder["years"] if int(y.get("year") or 0) == int(edit.get("year") or 0)), None)
        if y is None:
            y = {"year": int(edit.get("year") or _day(today).year), "milestones": []}
            ladder["years"].append(y)
        ms = [m for m in y["milestones"] if m.get("id") != edit["id"]]
        if not edit.get("remove"):
            ms.append({"id": str(edit["id"])[:40], "title": str(edit.get("title") or edit["id"])[:160],
                       "kind": str(edit.get("kind") or "road")[:20], "match": _str_list(edit.get("match"))[:12]})
        y["milestones"] = ms
    _write_json(path or LADDER, ladder)
    return ladder


# ------------------------------------------------------------------ gaps: welcome back, decay, drift
def last_active(st: dict) -> Optional[str]:
    dates = [e["date"] for e in st["events"] if e.get("kind") in ("contract", "log", "learning", "node", "ship", "cert", "project", "quest")]
    return max(dates) if dates else None


def welcome_back(bank: dict, st: dict, apps_view: Optional[dict], today: str, profile: dict) -> Optional[dict]:
    """After N idle days: no drama. A small first win, refreshers for what decayed,
    and plainly what slipped while he was away."""
    last = last_active(st)
    n = int(profile["style"].get("welcome_back_after_days") or 4)
    if not last:
        return None
    idle = (_day(today) - _day(last)).days
    if idle < n:
        return None
    missed = 0
    for d, day in st["days"].items():
        if last < d < today:
            missed += sum(1 for c in day.get("contracts", []) if c["key"] not in st["contracts"])
    closed = [f"{a['org']} ({a['programme']})" for a in (apps_view or {}).get("applications", [])
              if a["status"] in ("idea", "preparing") and a["closes"] and last < a["closes"] < today]
    nxt = next((a for a in (apps_view or {}).get("applications", []) if a["status"] in ("idea", "preparing")
                and a["days_left"] is not None and a["days_left"] >= 0), None)
    slipped = []
    if missed:
        slipped.append(f"{missed} planned contract{'s' if missed != 1 else ''} didn't happen")
    if closed:
        slipped.append("closed while you were away: " + ", ".join(closed))
    return {"idle_days": idle, "since": last, "slipped": slipped,
            "next_deadline": {"org": nxt["org"], "programme": nxt["programme"], "days_left": nxt["days_left"]} if nxt else None,
            "refreshers": [r["node_id"] for r in refreshers(bank, st, today, profile)][:3],
            "say": f"Welcome back. It's been {idle} days, and that's fine. Today starts with one small win."
                   + (f" What slipped: {'; '.join(slipped)}." if slipped else "")
                   + (f" The week is re-planned around {nxt['org']}, {nxt['days_left']} days out." if nxt else "")}


def refreshers(bank: dict, st: dict, today: str, profile: dict) -> list[dict]:
    """Skill decay: mastered nodes untouched for a while get a short spaced-review contract."""
    after = int(profile["style"].get("refresh_after_days") or 30)
    out = []
    for nid in bank["order"]:
        rec = st["nodes"].get(nid) or {}
        last = rec.get("last") or rec.get("mastered")
        if rec.get("status") != "mastered" or not last or (_day(today) - _day(last)).days < after:
            continue
        node = bank["nodes"][nid]
        out.append({"key": f"refresh/{nid}/{today}", "source": "practice", "slot": "evening", "node_id": nid, "node_name": node["name"],
                    "branch": node["branch"], "title": f"Refresher: {node['name']}", "minutes": 20, "xp": 15,
                    "context": f"Mastered, but untouched for {(_day(today) - _day(last)).days} days. Ten minutes from a blank page brings it back.",
                    "steps": ["From memory: write the three things this node lets you do", "Redo one old contract's check without notes",
                              f"Say: \"Jarvis, quiz me on {node['name']}\""],
                    "hint": "Struggling is the point: effortful recall is what makes it stick.",
                    "success_check": "All three written, and one check passed without notes.", "why": "Skill refresh",
                    "done": f"refresh/{nid}/{today}" in st["contracts"], "verified": False, **contract_context(bank, st, node)})
    out.sort(key=lambda c: -career_weight(bank, st, c["node_id"]))
    return out


def drift_nudge(plan: "Plan", now: Optional[datetime] = None) -> Optional[str]:
    """JARVIS speaks up when he has drifted for more than N days: at most once a day,
    never in quiet hours. Returns the line, or None (and records that it nudged)."""
    now = now or datetime.now()
    profile = load_profile()
    if in_quiet_hours(now, profile["style"]["quiet_hours"]):
        return None
    today = now.date().isoformat()
    with plan._lock:
        st = plan.load(today)
        last = last_active(st)
        if not last:
            return None
        idle = (now.date() - _day(last)).days
        if idle <= int(profile["style"].get("nudge_after_idle_days") or 3):
            return None
        if st.get("nudged_drift") == today:
            return None
        st["nudged_drift"] = today
        plan.save(st)
    d = plan.today(today)
    small = min((c for c in d["contracts"] if not c["done"]), key=lambda c: c["minutes"], default=None)
    return (f"It's been {idle} days since the last logged work. No pressure: the smallest thing on today's list is "
            f"{small['title']}, {small['minutes']} minutes." if small else f"It's been {idle} days. Want to start with something small?")


# ------------------------------------------------------------------ the learning log ("submit anything productive")
LEARN_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt", ".md", ".py", ".v", ".sv", ".vhd", ".c", ".cpp", ".h",
              ".ipynb", ".json", ".csv", ".m", ".tcl"}
LEARN_MAX_FILE = 10 * 1024 * 1024
LEARN_MAX_FILES = 6


def slugify(text: str, n: int = 6) -> str:
    words = [w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if w not in _STOP and w not in {"watched", "read", "did", "a", "an", "of", "on", "to", "in", "i", "my", "about", "some", "was", "learnt", "learned"}]
    return "-".join(words[:n])[:60] or "entry"


def match_nodes(bank: dict, text: str, k: int = 3) -> list[dict]:
    """Suggest the tree nodes a free-text entry is about: shared words with the node's
    name (weighted) and outcomes. He can correct it."""
    words = {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 2 and w not in _STOP}
    scored = []
    for nid in bank["order"]:
        n = bank["nodes"][nid]
        name = {w for w in re.findall(r"[a-z0-9]+", n["name"].lower()) if len(w) > 2}
        outs = {w for o in n["outcomes"] for w in re.findall(r"[a-z0-9]+", o.lower()) if len(w) > 3}
        sc = 3 * len(words & name) + len(words & outs) + sum(1 for w in words for x in name if len(w) > 4 and x.startswith(w[:5]))
        if sc >= 2:
            scored.append((sc, nid, n["name"]))
    scored.sort(key=lambda x: -x[0])
    return [{"id": nid, "name": nm, "score": sc} for sc, nid, nm in scored[:k]]


def add_learning(plan: "Plan", what: str, minutes: int = 0, note: str = "", tags: Optional[list] = None,
                 files: Optional[list] = None, nodes: Optional[list] = None, today: Optional[str] = None, via: str = "ui",
                 root: Optional[Path] = None) -> dict:
    """One learning-log entry: saved under learning/YYYY/MM/<date>_<slug>/ with the
    files renamed from his explanation, a meta.json, XP to the matched nodes."""
    import base64 as b64
    today = today or date.today().isoformat()
    what = " ".join((what or "").split())[:400]
    if not what:
        raise ValueError("say what you did")
    # every check before anything is written: a bad field never leaves a half entry on disk
    try:
        minutes = max(0, min(600, int(minutes or 0)))
    except (TypeError, ValueError):
        raise ValueError("minutes must be a number")
    if not _DATE.match(str(today)) or _date_or_none(today) is None:   # the folder name comes from it
        raise ValueError("today must be YYYY-MM-DD")
    note = str(note or "")
    files = files or []
    if not isinstance(files, list):
        raise ValueError("files must be a list")
    if len(files) > LEARN_MAX_FILES:
        raise ValueError(f"at most {LEARN_MAX_FILES} files")
    blobs = []
    for f in files:
        if not isinstance(f, dict):
            raise ValueError("a file is {name, data}")
        name = Path(str(f.get("name") or "")).name                 # never a path: the base name only
        ext = Path(name).suffix.lower()
        if ext not in LEARN_EXTS:
            raise ValueError(f"{name or 'a file'}: type not allowed")
        try:
            data = b64.b64decode(str(f.get("data") or ""), validate=True)
        except (ValueError, TypeError):
            raise ValueError(f"{name}: not valid base64")
        if not data or len(data) > LEARN_MAX_FILE:
            raise ValueError(f"{name}: empty or over {LEARN_MAX_FILE // (1024 * 1024)} MB")
        blobs.append((ext, data))
    bank = plan.bank()
    slug = slugify(what)
    base = (root or LEARNING) / today[:4] / today[5:7]
    folder = base / f"{today}_{slug}"
    k = 2
    while folder.exists():
        folder = base / f"{today}_{slug}-{k}"
        k += 1
    folder.mkdir(parents=True)
    saved = []
    for i, (ext, data) in enumerate(blobs, 1):
        p = folder / f"{slug}{'' if len(blobs) == 1 else f'-{i}'}{ext}"
        p.write_bytes(data)
        saved.append(p.name)
    suggested = match_nodes(bank, f"{what} {note} {' '.join(_str_list(tags))}")
    chosen = [n for n in _str_list(nodes) if n in bank["nodes"]] if nodes is not None else [s["id"] for s in suggested[:1]]
    xp = (min(60, 10 * (minutes // 30)) or 5) + (5 if saved else 0)
    meta = {"id": folder.name, "date": today, "what": what, "minutes": minutes, "tags": _str_list(tags)[:10], "note": note[:2000],
            "files": saved, "suggested_nodes": suggested, "nodes": chosen, "xp": xp, "via": via}
    (folder / "meta.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    with plan._lock:
        st = plan.load(today)
        for nid in chosen:
            st["nodes"].setdefault(nid, {})["last"] = today
        st["xp"] += xp
        plan._event(st, today, "learning", minutes=minutes, note=what[:120], node=chosen[0] if chosen else None, nodes=chosen,
                    xp=xp, rep=rep_for(bank["nodes"][chosen[0]]["branch"]) if chosen else None, entry=folder.name, verified=bool(saved), via=via)
        plan.save(st)
    return {"ok": True, "entry": meta, "say": f"Logged: {what}." + (f" Counted toward {bank['nodes'][chosen[0]]['name']}." if chosen else "")
            + f" Plus {xp} XP."}


def learning_timeline(root: Optional[Path] = None, limit: int = 60) -> list[dict]:
    out = []
    for meta in sorted((root or LEARNING).glob("*/*/*/meta.json"), reverse=True)[:limit]:
        m = _read_json(meta, None)
        if isinstance(m, dict):
            out.append(m)
    return out


def correct_learning(plan: "Plan", entry: str, nodes: list, root: Optional[Path] = None) -> dict:
    """He corrects the matched nodes: the meta is rewritten (the XP stays where it was paid)."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}_[a-z0-9\-]+", entry or ""):
        raise KeyError(entry)
    p = (root or LEARNING) / entry[:4] / entry[5:7] / entry / "meta.json"
    m = _read_json(p, None)
    if not isinstance(m, dict):
        raise KeyError(entry)
    bank = plan.bank()
    m["nodes"] = [n for n in _str_list(nodes) if n in bank["nodes"]]
    p.write_text(json.dumps(m, indent=1, ensure_ascii=False), encoding="utf-8")
    with plan._lock:
        st = plan.load()
        for nid in m["nodes"]:
            st["nodes"].setdefault(nid, {})["last"] = m["date"]
        plan.save(st)
    return m
