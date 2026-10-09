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

Storage (gitignored, personal): app/data/germoney/kv/*.json, one file per key,
written atomically; the whole folder is snapshotted once a day (14 kept), because
"my progress vanished" is the one bug a progress app cannot have.
"""
from __future__ import annotations

import base64
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
