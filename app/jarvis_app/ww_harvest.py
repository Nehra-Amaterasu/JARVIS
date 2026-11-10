"""The question harvester: finds exam- and GATE-level questions with tools and puts them on local disk.

    python -m jarvis_app.ww_harvest --subject control --topic "Routh-Hurwitz" --max 10 --enable
    Harvester().queue_topic(...) / .run(max_requests) / .pause() / .resume() / .sources_view()

The terms are docs/research/question-sources.md, written down in code:
  * openly licensed text is stored with its licence line (MIT OCW CC BY-NC-SA 4.0; OpenStax, the licence
    read from each book's own page; the Stack Exchange API, CC BY-SA, `backoff` honoured, 300 requests a day);
  * GATE papers, NPTEL and textbooks are pointers only (year, paper, question number, topic, url): the
    store refuses a pointer that carries text, and the GATE PDF is read in memory and never cached;
  * coaching banks, Reddit and GATE Overflow (terms unread) are not sources at all (NOT_USED);
  * a source whose licence line is not recorded stays off, with the reason printed.
Politeness, one rule per line of the research file: robots.txt per host (once a day), one request at a
time, 2 to 5 s between requests, a User-Agent that names the project and carries no address, every page
cached on disk, never a login, never a 403 or 429 twice (a second one stops that host for the day).

Nothing runs by itself: no thread and no network at import. The queue is only worked by run() (the
run route or the CLI), and only when the owner has switched the harvester on (resume). The queue and
the page cache live beside the bank (data/bank/questions/_harvest/) so a restart loses nothing.
PDF text comes from the local `pdftotext` binary; if it is absent the error says so (no Python PDF library).
"""
from __future__ import annotations

import argparse
import hashlib
import html as htmllib
import json
import os
import random
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import urllib.robotparser
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import quote, urljoin, urlparse

from . import ww_bank_store as store

# Names the project, says what it is and that it obeys robots.txt; no address (the owner's rule, 9 Nov).
UA_TOKEN = "JARVIS-WellWisher-QuestionHarvester"
USER_AGENT = f"{UA_TOKEN}/1.0 (personal, non-commercial study tool; obeys robots.txt; one request at a time)"
DELAY = (2.0, 5.0)                 # seconds between two requests, drawn at random (research file section 6)
MATH_BACKSLASH_DOLLAR = ("electronics",)
SE_DAILY = 300                    # Stack Exchange anonymous requests per IP per day
MAX_PAGE = 8 * 1024 * 1024
MAX_PDF = 40 * 1024 * 1024
TODAY_REFUSALS = ("robots", "rate-limit", "licence-unknown", "blocked", "backoff", "quota", "no-source", "pdf-reader-missing", "network", "budget")

# ------------------------------------------------------------------ sources
SOURCES: dict[str, dict] = {
    "mit_ocw": {"name": "Open course material (MIT OpenCourseWare)", "kind": "open", "license": "CC BY-NC-SA 4.0",
                "hosts": ["ocw.mit.edu"], "terms_url": "https://ocw.mit.edu/terms/",
                "note": "Non-commercial, share-alike, attribution. Third-party items inside a course are excluded and skipped."},
    "openstax": {"name": "Open textbooks (OpenStax)", "kind": "open", "license": None, "hosts": ["openstax.org"],
                 "terms_url": "https://openstax.org/faq",
                 "note": "Licence per book: read from the book's own page before anything is stored. Instructor solutions are not used."},
    "stackexchange": {"name": "Q&A site API (Stack Exchange)", "kind": "open", "license": "CC BY-SA 4.0", "hosts": ["api.stackexchange.com"],
                      "terms_url": "https://stackoverflow.com/legal/terms-of-service",
                      "note": f"Official API only, anonymous: {SE_DAILY} requests a day, the `backoff` field is honoured. Never the data dump or HTML."},
    "gate_official": {"name": "Official GATE papers", "kind": "pointer", "license": "reserved", "hosts": ["gate2026.iitg.ac.in"],
                      "terms_url": "https://gate2026.iitg.ac.in/QPs-answer-keys.html",
                      "note": "All Rights Reserved: year, paper, question number, topic, marks and link only. The PDF is read in memory and never saved."},
    "nptel": {"name": "NPTEL", "kind": "pointer", "license": "unconfirmed", "hosts": [], "manual": True,
              "terms_url": "https://gate.nptel.ac.in/copyrights.html",
              "note": "Licence not confirmed by NPTEL itself, so references only (typed in); nothing is fetched."},
    "textbooks": {"name": "Textbooks", "kind": "pointer", "license": "reserved", "hosts": [], "manual": True, "terms_url": "",
                  "note": "Book, edition, problem number so he can open his own copy; nothing is fetched."},
}
NOT_USED = [
    {"name": "Indian coaching banks", "reason": "paid and copyrighted; no copying and no paraphrase of their solutions"},
    {"name": "Reddit", "reason": "chat, not questions; its terms do not allow this use"},
    {"name": "GATE Overflow", "reason": "its terms were not readable (HTTP 403), so its licence is unknown"},
]
ORDER = ("stackexchange", "mit_ocw", "openstax", "gate_official")

# His subjects -> the GATE EC syllabus headings (question-sources.md section 1, headings verbatim). `match` is a
# substring of the subject id; `gate` is None where GATE EC has no line (the tier stays exam). `ocw` slugs are the
# course folders under https://ocw.mit.edu/courses/ (one live check on 9 Nov; a wrong slug is a refused fetch, not bad data).
GATE_MAP: list[dict] = [
    {"key": "control", "match": ("control",), "gate": "Section 6: Control Systems",
     "keywords": ("transfer function", "routh", "nyquist", "bode", "root locus", "stability", "compensat", "state variable", "feedback", "block diagram", "steady-state"),
     "se": ("electronics", "dsp"), "ocw": ("6-302-feedback-systems-spring-2007",), "openstax": ()},
    {"key": "digital_comm", "match": ("digital", "dcom", "comm"), "gate": "Section 7: Communications (and Section 2: sampling)",
     "keywords": ("entropy", "channel capacity", "pcm", "dpcm", "ask", "psk", "fsk", "qam", "intersymbol", "matched filter", "ber", "hamming", "crc", "sampling", "random process"),
     "se": ("dsp", "electronics"), "ocw": ("6-011-introduction-to-communication-control-and-signal-processing-spring-2010",), "openstax": ()},
    {"key": "micro", "match": ("micro", "analog", "electronic", "mec"), "gate": "Section 4: Analog Circuits; Section 3: Electronic Devices",
     "keywords": ("bjt", "mosfet", "amplifier", "biasing", "small signal", "current mirror", "differential", "diode", "frequency response", "op-amp", "feedback"),
     "se": ("electronics",), "ocw": ("6-012-microelectronic-devices-and-circuits-fall-2005",), "openstax": ()},
    {"key": "fab", "match": ("fab", "ic_", "ic-", "icf"), "gate": "Section 3: Electronic Devices (nearest line; oxidation, diffusion, implant and lithography have none)",
     "keywords": ("oxidation", "diffusion", "implant", "lithograph", "mos capacitor", "energy band", "carrier", "doping", "junction", "mosfet"),
     "se": ("electronics",), "ocw": ("6-774-physics-of-microfabricated-devices-spring-2005",), "openstax": ()},
    {"key": "maths", "match": ("math", "stochastic", "applied"), "gate": "Section 1: Engineering Mathematics; Section 7: Random Processes",
     "keywords": ("probability", "random variable", "expectation", "variance", "integral", "gauss", "stokes", "green", "vector", "stochastic", "autocorrelation", "power spectral", "white noise", "markov"),
     "se": ("math",), "ocw": ("6-041sc-probabilistic-systems-analysis-and-applied-probability-fall-2013",), "openstax": ("calculus-volume-3",)},
    {"key": "network", "match": ("network",), "gate": "Section 2: Networks, Signals and Systems (network synthesis is not in GATE EC)",
     "keywords": ("node", "mesh", "thevenin", "norton", "superposition", "laplace", "two-port", "wye", "delta", "transient", "resonan", "signals"),
     "se": ("electronics",), "ocw": ("6-002-circuits-and-electronics-spring-2007", "6-003-signals-and-systems-fall-2011"), "openstax": ()},
    {"key": "none", "match": ("iot", "ev", "pie", "constitution"), "gate": None, "keywords": (), "se": (), "ocw": (), "openstax": ()},
]


def gate_map(subject: str) -> Optional[dict]:
    s = str(subject or "").lower()
    return next((m for m in GATE_MAP if any(x in s for x in m["match"])), None)


class Refused(Exception):
    """A fetch that must not happen or did not work, with a stable code and the reason in words."""

    def __init__(self, code: str, reason: str):
        super().__init__(reason)
        self.code, self.reason = code, reason


class PdfReaderMissing(RuntimeError):
    pass


# ------------------------------------------------------------------ text helpers
def find_pdftotext() -> Optional[str]:
    # On this machine poppler comes with Git for Windows (C:\Program Files\Git\mingw64\bin), which is not on every shell's PATH.
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    for cand in (os.environ.get("PDFTOTEXT"), shutil.which("pdftotext"), pf + r"\Git\mingw64\bin\pdftotext.exe",
                 r"C:\msys64\mingw64\bin\pdftotext.exe", "/mingw64/bin/pdftotext", "/usr/bin/pdftotext"):
        if cand and (Path(cand).exists() or Path(cand + ".exe").exists()):
            return cand
    return None


def pdf_text(data: bytes, first: Optional[int] = None, last: Optional[int] = None) -> str:
    """Text of a PDF through the local pdftotext (poppler). No Python PDF library is installed or needed."""
    exe = find_pdftotext()
    if not exe:
        raise PdfReaderMissing("PDF text needs the local pdftotext (poppler), which was not found; "
                               "install it or set PDFTOTEXT to its path. No Python PDF library is used.")
    with tempfile.TemporaryDirectory(prefix="ww-pdf-") as td:
        src = Path(td) / "in.pdf"
        src.write_bytes(data)
        cmd = [exe, "-enc", "UTF-8", "-layout"] + (["-f", str(first)] if first else []) + (["-l", str(last)] if last else []) + [str(src), "-"]
        r = subprocess.run(cmd, capture_output=True, timeout=90)
    if r.returncode != 0:
        raise Refused("network", "pdftotext could not read the file: " + r.stderr.decode("utf-8", "replace")[:120])
    return r.stdout.decode("utf-8", "replace")


_PROB = re.compile(r"^[ \t]*(?:Problem|Question|Exercise|Q\.?)[ \t]*(\d+[A-Za-z]?)[.:)]?[ \t]+(?=\S)|^[ \t]*(\d{1,2})[.)][ \t]+(?=[A-Z])", re.M)
_NOISE = re.compile(r"^\s*(?:page \d+|\d+ ?/ ?\d+|\d{1,3})\s*$", re.I)
_THIRD_PARTY = re.compile(r"courtesy of|used with permission|all rights reserved|not covered by (?:our|the) creative commons", re.I)


def split_problems(text: str) -> list[tuple[str, str]]:
    """Numbered problems in extracted text: [(label, body)], bodies of 40 to 2000 characters, whitespace collapsed."""
    marks = [(m.start(), m.end(), m.group(1) or m.group(2)) for m in _PROB.finditer(text)]
    out = []
    for i, (_, end, label) in enumerate(marks):
        stop = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        lines = [ln for ln in text[end:stop].splitlines() if not _NOISE.match(ln)]
        body = re.sub(r"\s+", " ", " ".join(lines)).strip()
        if 40 <= len(body) <= store.MAX_TEXT:
            out.append((label, body))
    return out


def topic_terms(topic: str) -> list[str]:
    stop = {"and", "the", "for", "with", "of", "to", "in", "on", "a", "an", "from", "its", "using"}
    words = [w for w in re.findall(r"[a-z][a-z0-9]{2,}", str(topic).lower()) if w not in stop]     # "Routh-Hurwitz" is two words: a post may spell it with a space
    return [w[:6] if len(w) >= 7 else w for w in words]


def matches_topic(text: str, topic: str, keywords: tuple = ()) -> bool:
    """A problem is about the topic when at least min(2, n) of its words (6-letter stems) appear, or when one of
    the topic's own phrase appears whole. The syllabus keywords only break a tie for a one-word topic."""
    low = re.sub(r"[-‐-―]", " ", text.lower())
    terms = topic_terms(topic)
    if not terms:
        return False
    if re.sub(r"[-‐-―]", " ", str(topic).lower()).strip() in low:
        return True
    hits = sum(1 for t in terms if t in low)
    if hits >= min(2, len(terms)):
        return True
    return len(terms) == 1 and hits == 1 and any(k in low for k in keywords)


def guess_marks(text: str) -> float:
    """Marks are a guess, said so in the field name of the plan: an explicit '(10 points)' wins, else by length
    onto the SEE shape (2, 5, 7), because the real value is only known on his paper."""
    m = re.search(r"[\[(]\s*(\d{1,3}(?:\.5)?)\s*(?:points?|pts?|marks?)\s*[\])]", text, re.I)
    if m and 0 < float(m.group(1)) <= 100:
        return float(m.group(1))
    n = len(text)
    return 2.0 if n < 150 else 5.0 if n < 450 else 7.0


def html_to_text(fragment: str) -> Optional[str]:
    """Plain text of a post body, or None when it has a figure we cannot show (a question without its picture is wrong)."""
    import lxml.html
    root = lxml.html.fromstring(f"<div>{fragment}</div>")
    if root.xpath(".//img"):
        return None
    for bad in root.xpath(".//script|.//style"):
        bad.getparent().remove(bad)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", root.text_content())).strip()      # text_content() has already decoded the entities


# ------------------------------------------------------------------ the polite fetcher
def _httpx_transport(url: str, headers: dict, timeout: float, max_bytes: int) -> tuple[int, dict, bytes]:
    import httpx
    try:
        with httpx.Client(follow_redirects=False, timeout=timeout, headers=headers) as c:
            with c.stream("GET", url) as r:
                buf = bytearray()
                for chunk in r.iter_bytes():
                    buf += chunk
                    if len(buf) > max_bytes:
                        raise Refused("network", f"the file is over {max_bytes // (1024 * 1024)} MB")
                return r.status_code, {k.lower(): v for k, v in r.headers.items()}, bytes(buf)
    except httpx.HTTPError as e:
        raise Refused("network", f"the request failed: {type(e).__name__}") from e


class Harvester:
    """The queue, its state on disk and the polite fetcher. Tests inject transport, sleep, clock and today."""

    def __init__(self, transport: Optional[Callable] = None, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.time, today: Optional[Callable[[], str]] = None,
                 delay: tuple[float, float] = DELAY, rng: Optional[random.Random] = None):
        self.transport = transport or _httpx_transport
        self.sleep, self.clock = sleep, clock
        self.today = today or (lambda: date.today().isoformat())
        self.delay, self.rng = delay, rng or random.Random()
        self._lock = threading.RLock()
        self._run_lock = threading.Lock()
        self._last_request = 0.0
        self._budget: Optional[int] = None
        self.requests_made = 0

    # ---- state on disk
    @property
    def root(self) -> Path:
        return store.harvest_dir()

    def _path(self) -> Path:
        return self.root / "state.json"

    def load(self) -> dict:
        try:
            st = json.loads(self._path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            st = {}
        st.setdefault("enabled", False)
        st.setdefault("paused", False)
        st.setdefault("items", [])
        st.setdefault("host_blocks", {})
        st.setdefault("blocked_urls", {})
        st.setdefault("backoff", {})
        st.setdefault("se_requests", {"date": "", "n": 0})
        st.setdefault("openstax_licenses", {})
        st.setdefault("last_run", None)
        st.setdefault("last_request_at", None)
        for it in st["items"]:
            if it.get("status") == "fetching" and not self._run_lock.locked():
                it["status"] = "waiting"          # a crash mid-fetch: the queue survives, the half-done item is retried
        return st

    def save(self, st: dict) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self._path().with_suffix(".tmp")
        tmp.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self._path())

    # ---- owner switches
    def resume(self) -> dict:
        with self._lock:
            st = self.load()
            st["enabled"], st["paused"] = True, False
            self.save(st)
        return self.status()

    def pause(self) -> dict:
        with self._lock:
            st = self.load()
            st["paused"] = True
            self.save(st)
        return self.status()

    # ---- queue
    def queue_topic(self, subject: str, topic: str, unit: Optional[int] = None, tier: str = "gate", max: int = 20,
                    sources: Optional[list] = None) -> dict:
        subject = store.slug(subject)
        topic = re.sub(r"\s+", " ", str(topic or "")).strip()
        if not topic or len(topic) > 80:
            raise ValueError("topic is required, up to 80 characters")
        if tier not in store.TIERS:
            raise ValueError("tier is exam or gate")
        if unit is not None and (isinstance(unit, bool) or not isinstance(unit, int) or not 1 <= unit <= 10):
            raise ValueError("unit is a whole number from 1 to 10, or empty")
        if isinstance(max, bool) or not isinstance(max, int) or not 1 <= max <= 100:
            raise ValueError("max is a whole number from 1 to 100")
        srcs = [s for s in (sources or ORDER) if s in SOURCES and not SOURCES[s].get("manual")]
        if not srcs:
            raise ValueError("sources: pick from " + ", ".join(s for s in SOURCES if not SOURCES[s].get("manual")))
        with self._lock:
            st = self.load()
            for it in st["items"]:
                if it["subject"] == subject and it["topic"].lower() == topic.lower() and it["tier"] == tier and it["status"] in ("waiting", "fetching"):
                    return it
            it = {"id": uuid.uuid4().hex[:10], "subject": subject, "topic": topic,
                  "unit": unit, "tier": tier, "max": max, "sources": srcs, "status": "waiting", "fetched": 0, "added": 0, "reason": "", "reason_code": "",
                  "per_source": [], "queued_at": self._iso(), "updated_at": self._iso(), "refused_on": None}
            st["items"].append(it)
            del st["items"][:-300]
            self.save(st)
        return it

    def queue_missing_topics(self, subject: str, units: list[dict], bank: list[dict], tier: str = "gate",
                             want: int = 3, limit: int = 12) -> list[dict]:
        """The generator's shortfall: every topic of the subject's units that has fewer than `want` questions of the
        tier (typed bank plus disk) is queued, up to `limit` at a time. Returns the queued items."""
        have: dict[str, int] = {}
        for q in list(bank) + store.load_for(subject):
            if (q.get("tier") or "exam") == tier:
                k = (str(q.get("topic") or "")).lower()
                have[k] = have.get(k, 0) + 1
        out = []
        for u in units or []:
            for t in u.get("topics") or []:
                name = t if isinstance(t, str) else str((t or {}).get("name") or (t or {}).get("topic") or "")
                if name and have.get(name.lower(), 0) < want and len(out) < limit:
                    out.append(self.queue_topic(subject, name[:80], unit=int(u["n"]) if u.get("n") else None, tier=tier, max=10))
        return out

    # ---- views
    def _iso(self) -> str:
        return datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(timespec="seconds")

    def status(self) -> dict:
        st = self.load()
        items = st["items"]
        cnt = lambda s: sum(1 for i in items if i["status"] == s)
        disk = store.counts()
        word = "off" if not st["enabled"] else "paused" if st["paused"] else "fetching" if cnt("fetching") else "queued" if cnt("waiting") else "idle"
        return {"enabled": st["enabled"], "paused": st["paused"], "state": word, "queued": cnt("waiting"), "fetching": cnt("fetching"),
                "refused": cnt("refused"), "done": cnt("done"), "failed": cnt("failed"), "on_disk": disk["total"], "last_run": st["last_run"],
                "last_request_at": st["last_request_at"], "items": items[-60:][::-1]}

    def flags(self, subject: Optional[str] = None) -> dict:
        """The few honest numbers the phone and the Practice cell show; nothing here is estimated."""
        s = self.status()
        n_disk = store.counts(subject)["total"] if subject else s["on_disk"]
        queued = s["queued"] if not subject else sum(1 for i in self.load()["items"] if i["subject"] == subject and i["status"] == "waiting")
        return {"state": s["state"], "enabled": s["enabled"], "paused": s["paused"], "queued": queued, "fetching": s["fetching"],
                "on_disk": n_disk, "last_request_at": s["last_request_at"]}

    def sources_view(self) -> dict:
        st = self.load()
        by_src: dict[str, int] = {}
        for sub in store.counts()["subjects"]:
            for r in store.all_records(sub):
                by_src[r.get("source_id", "")] = by_src.get(r.get("source_id", ""), 0) + 1
        today, rows = self.today(), []
        for sid, s in SOURCES.items():
            lic, reason = s["license"], ""
            if sid == "openstax":
                known = sorted(set(st["openstax_licenses"].values()))
                lic = ", ".join(known) if known else None
            if s["kind"] == "pointer":
                status = "pointer"
                reason = "references only, never stored text" + ("; typed in by hand" if s.get("manual") else "")
            elif not lic:
                status, reason = "off", f"{s['name']}: licence not recorded, so it stays off."
            elif not st["enabled"]:
                status, reason = "off", "the harvester is off"
            elif st["paused"]:
                status, reason = "paused", "paused"
            else:
                status = "on"
            hb = [h for h in s["hosts"] if st["host_blocks"].get(h, {}).get("date") == today and st["host_blocks"][h].get("strikes", 0) >= 2]
            if hb and status == "on":
                status, reason = "stopped today", f"{hb[0]} refused twice today; it is left alone until tomorrow"
            if sid == "stackexchange":
                used = st["se_requests"]["n"] if st["se_requests"]["date"] == today else 0
                if status == "on" and used >= SE_DAILY:
                    status, reason = "limit", f"{SE_DAILY} requests used today"
            rows.append({"id": sid, "name": s["name"], "kind": s["kind"], "status": status, "license": lic or "not recorded", "reason": reason,
                         "terms_url": s["terms_url"], "note": s["note"], "on_disk": by_src.get(sid, 0)})
        pdf = find_pdftotext()
        used = st["se_requests"]["n"] if st["se_requests"]["date"] == today else 0
        return {"sources": rows, "not_used": NOT_USED, "user_agent": USER_AGENT, "delay_seconds": list(self.delay),
                "pdf_reader": {"available": bool(pdf), "path": pdf or "", "note": "PDF text uses the local PDF reader when present. A Python PDF library is not installed."},
                "stackexchange_requests_today": used, "stackexchange_daily_limit": SE_DAILY}

    # ---- the polite GET
    def _host_stopped(self, st: dict, host: str) -> bool:
        b = st["host_blocks"].get(host)
        return bool(b and b.get("date") == self.today() and b.get("strikes", 0) >= 2)

    def _spend(self) -> None:
        if self._budget is not None:
            if self._budget <= 0:
                raise Refused("budget", "this run's request budget is spent; the rest stays queued")
            self._budget -= 1

    def _pace(self) -> None:
        wait = self.delay[0] + (self.delay[1] - self.delay[0]) * self.rng.random()
        since = self.clock() - self._last_request
        if self._last_request and since < wait:
            self.sleep(wait - since)

    def _request(self, st: dict, url: str, max_bytes: int) -> tuple[int, dict, bytes]:
        """One network request, paced, counted, and with the 403/429 rule applied. Caller holds no lock on the net."""
        host = urlparse(url).hostname or ""
        if self._host_stopped(st, host):
            raise Refused("blocked", f"{host} refused twice today (403 or 429); it is left alone until tomorrow")
        until = st["backoff"].get(host, 0)
        if until > self.clock():
            raise Refused("backoff", f"{host} asked us to back off until {datetime.fromtimestamp(until).strftime('%H:%M')}")
        if st["blocked_urls"].get(url) == self.today():
            raise Refused("rate-limit", "this address already answered 403 or 429 today and is not asked again")
        self._spend()
        self._pace()
        self._last_request = self.clock()
        self.requests_made += 1
        st["last_request_at"] = self._iso()
        status, headers, body = self.transport(url, {"User-Agent": USER_AGENT, "Accept": "*/*", "Accept-Language": "en"}, 30.0, max_bytes)
        if status in (403, 429):
            b = st["host_blocks"].setdefault(host, {"date": self.today(), "strikes": 0, "status": status})
            if b.get("date") != self.today():
                b.update({"date": self.today(), "strikes": 0})
            b["strikes"] += 1
            b["status"] = status
            st["blocked_urls"][url] = self.today()
            st["blocked_urls"] = {u: d for u, d in st["blocked_urls"].items() if d == self.today()}
            self.save(st)
            more = " and the host is stopped for today" if b["strikes"] >= 2 else ""
            raise Refused("rate-limit", f"HTTP {status} from {host}; not retried today{more}")
        return status, headers, body

    def _robots_ok(self, st: dict, url: str, depth: int = 0) -> None:
        p = urlparse(url)
        host = p.hostname or ""
        rdir = self.root / "robots"
        f = rdir / f"{re.sub(r'[^a-z0-9.-]', '_', host)}.json"
        rec = None
        try:
            rec = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        if not rec or rec.get("date") != self.today():
            status, _, body = self._request(st, f"{p.scheme}://{p.netloc}/robots.txt", 512 * 1024)
            if status in (401, 403):
                raise Refused("robots", f"robots.txt of {host} is not readable (HTTP {status}), so nothing is fetched there")
            if 400 <= status < 500:
                # RFC 9309: a 4xx for robots.txt means there are no rules (api.stackexchange.com answers 400, seen live on 9 Nov).
                rec = {"date": self.today(), "text": ""}
            elif status == 200:
                rec = {"date": self.today(), "text": body.decode("utf-8", "replace")}
            else:
                raise Refused("robots", f"robots.txt of {host} is not reachable (HTTP {status}), so nothing is fetched there")
            rdir.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(rec), encoding="utf-8")
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(rec["text"].splitlines())
        rp.modified()                      # without this can_fetch() answers False for every URL (last_checked stays 0)
        if not rp.can_fetch(UA_TOKEN, url):
            raise Refused("robots", f"robots.txt of {host} disallows {p.path or '/'}")

    def get(self, url: str, st: dict, cache: bool = True, max_bytes: int = MAX_PAGE, hops: int = 0) -> tuple[int, dict, bytes]:
        """robots, cache, pace, fetch. Raises Refused. A cached page costs no request and no delay."""
        p = urlparse(url)
        if p.scheme not in ("http", "https") or p.username or p.password or not p.hostname:
            raise Refused("blocked", "only plain http(s) addresses without a login are fetched")
        key = hashlib.sha256(url.encode()).hexdigest()[:24]
        cdir = self.root / "cache" / re.sub(r"[^a-z0-9.-]", "_", p.hostname)
        if cache and (cdir / f"{key}.body").exists():
            return 200, json.loads((cdir / f"{key}.meta").read_text(encoding="utf-8")), (cdir / f"{key}.body").read_bytes()
        self._robots_ok(st, url)
        status, headers, body = self._request(st, url, max_bytes)
        if status in (301, 302, 303, 307, 308) and headers.get("location") and hops < 3:
            return self.get(urljoin(url, headers["location"]), st, cache, max_bytes, hops + 1)
        if status != 200:
            raise Refused("network", f"HTTP {status} from {p.hostname}")
        if cache:
            cdir.mkdir(parents=True, exist_ok=True)
            (cdir / f"{key}.meta").write_text(json.dumps({"url": url, "fetched": self._iso(), "content-type": headers.get("content-type", "")}), encoding="utf-8")
            (cdir / f"{key}.body").write_bytes(body)
        return 200, headers, body

    # ---- the queue worker
    def run(self, max_requests: int = 10) -> dict:
        """Work the waiting items, at most `max_requests` network requests, one at a time. Only when switched on."""
        st0 = self.load()
        if not st0["enabled"]:
            return {"ran": False, "reason": "the harvester is off: the owner switches it on first", "requests": 0}
        if st0["paused"]:
            return {"ran": False, "reason": "paused", "requests": 0}
        if not self._run_lock.acquire(blocking=False):
            return {"ran": False, "reason": "a run is already going", "requests": 0}
        try:
            self._budget, self.requests_made = int(max_requests), 0
            results = []
            st0 = self.load()
            for it in st0["items"]:
                # A refusal holds for the day it happened (a 403 or robots answer is not asked again), then the item is tried afresh.
                if it["status"] == "refused" and it.get("refused_on") != self.today() and it.get("reason_code") != "no-source":
                    it["status"] = "waiting"
            self.save(st0)
            for it in [i for i in st0["items"] if i["status"] == "waiting"]:
                if self._budget <= 0:
                    break
                st = self.load()
                cur = next((i for i in st["items"] if i["id"] == it["id"]), None)
                if cur is None or cur["status"] != "waiting":
                    continue
                if cur.get("refused_on") == self.today():
                    continue                      # refused today: not tried again until tomorrow
                cur["status"], cur["updated_at"] = "fetching", self._iso()
                self.save(st)
                self._process(cur, st)
                self.save(st)
                results.append({k: cur[k] for k in ("id", "subject", "topic", "status", "added", "reason")})
            st = self.load()
            st["last_run"] = self._iso()
            self.save(st)
            return {"ran": True, "requests": self.requests_made, "items": results}
        finally:
            self._budget = None
            self._run_lock.release()

    def _process(self, it: dict, st: dict) -> None:
        gm = gate_map(it["subject"])
        per, added_total, first_refusal, stopped_early = [], 0, None, False
        for sid in it["sources"]:
            if added_total >= it["max"]:
                break
            src = SOURCES[sid]
            try:
                if src["kind"] == "open" and not src["license"] and sid != "openstax":
                    raise Refused("licence-unknown", f"{src['name']}: licence not recorded, so it stays off.")
                if gm is None or (it["tier"] == "gate" and gm["gate"] is None):
                    raise Refused("no-source", "no allowed source covers this subject at this tier (GATE EC has no matching section)")
                found: list = []
                err: Optional[Refused] = None
                try:
                    FETCHERS[sid](self, st, it, gm, it["max"] - added_total, found)
                except Refused as e:
                    err = e                    # what was found before the refusal is still good and is kept
                except PdfReaderMissing as e:
                    err = Refused("pdf-reader-missing", str(e))
                res = store.add(it["subject"], found, sid) if found else {"added": 0, "duplicate": 0, "rejected": []}
                added_total += res["added"]
                if err is not None and not found:
                    raise err
                per.append({"source": sid, "status": "ok", "found": len(found), "added": res["added"], "duplicate": res["duplicate"],
                            "rejected": res["rejected"][:3], "reason": f"stopped early: {err.reason}" if err else ""})
                if err is not None and err.code == "budget":
                    stopped_early = True
                    break
            except Refused as e:
                per.append({"source": sid, "status": "refused", "found": 0, "added": 0, "reason_code": e.code, "reason": e.reason})
                first_refusal = first_refusal or e
                if e.code == "budget":
                    stopped_early = True
                    break
        it["per_source"], it["updated_at"] = per, self._iso()
        it["added"] = it["fetched"] = it.get("added", 0) + added_total
        ok = [p for p in per if p["status"] == "ok"]
        if stopped_early and not ok:
            it["status"], it["reason"], it["reason_code"] = "waiting", "run budget spent; stays queued", "budget"
        elif ok:
            it["status"], it["reason"], it["reason_code"] = "done", "", ""
            dropped = [p for p in per if p["status"] == "refused"]
            if dropped:
                it["reason"] = "; ".join(f"{p['source']}: {p['reason']}" for p in dropped)[:300]
        else:
            it["status"] = "refused"
            it["reason"] = (first_refusal.reason if first_refusal else "nothing allowed to fetch")[:300]
            it["reason_code"] = first_refusal.code if first_refusal else "no-source"
            it["refused_on"] = self.today()


# ------------------------------------------------------------------ per-source fetchers
def _pdf_links(page: bytes, base: str, words: tuple) -> list[tuple[str, str]]:
    import lxml.html
    root = lxml.html.fromstring(page)
    root.make_links_absolute(base)
    out = []
    for a in root.xpath("//a[@href]"):
        href, label = a.get("href"), re.sub(r"\s+", " ", a.text_content()).strip()
        low = (href + " " + label).lower()
        if href.lower().split("?")[0].endswith(".pdf") and any(w in low for w in words) and "solution" not in low and "_sol" not in low:
            out.append((href, label))
    return out


def _page_links(page: bytes, base: str, within: str, words: tuple) -> list[str]:
    import lxml.html
    root = lxml.html.fromstring(page)
    root.make_links_absolute(base)
    seen, out = set(), []
    for a in root.xpath("//a[@href]"):
        href = a.get("href").split("#")[0]
        low = (href + " " + a.text_content()).lower()
        if href.startswith(within) and href not in seen and not href.lower().endswith(".pdf") and any(w in low for w in words):
            seen.add(href)
            out.append(href)
    return out


def _problems_to_records(pdf: bytes, topic: str, keywords: tuple, tier: str, unit: Optional[int], source: str, url: str, lic: str,
                         course: str, label: str, limit: int) -> list[dict]:
    text = pdf_text(pdf)
    recs = []
    for num, body in split_problems(text):
        if _THIRD_PARTY.search(body) or not matches_topic(body, topic, keywords):
            continue
        recs.append({"origin": "cc-verbatim", "tier": tier, "unit": unit, "topic": topic, "marks": guess_marks(body), "question": body,
                     "source": f"{source}, {label}, {lic}", "source_url": url, "license": lic, "ref": f"{course} {label} Problem {num}"})
        if len(recs) >= limit:
            break
    return recs


def fetch_mit_ocw(h: Harvester, st: dict, it: dict, gm: dict, limit: int, recs: list) -> None:
    if not gm["ocw"]:
        raise Refused("no-source", "no MIT OCW course is mapped to this subject")
    lic = SOURCES["mit_ocw"]["license"]
    for slug in gm["ocw"]:
        base = f"https://ocw.mit.edu/courses/{slug}/"
        _, _, page = h.get(base, st)
        course = slug.split("-")[0] + "." + slug.split("-")[1] if "-" in slug else slug
        pages = _page_links(page, base, base, ("assignment", "problem", "pset", "exam", "quiz", "final", "homework"))[:4]
        pdfs = _pdf_links(page, base, ("assignment", "problem", "pset", "exam", "quiz", "final", "homework"))
        for pg in pages:
            _, _, body = h.get(pg, st)
            pdfs += _pdf_links(body, pg, ("assignment", "problem", "pset", "exam", "quiz", "final", "homework", "pdf"))
        seen = set()
        for href, label in pdfs[:6]:
            if href in seen:
                continue
            seen.add(href)
            _, _, pdf = h.get(href, st, max_bytes=MAX_PDF)
            recs += _problems_to_records(pdf, it["topic"], gm["keywords"], it["tier"], it["unit"], f"MIT OCW {course}", href, lic,
                                         course, label or Path(urlparse(href).path).name, limit - len(recs))
            if len(recs) >= limit:
                return
    return


OPENSTAX_LICENCE = re.compile(r"Creative Commons Attribution(?:[- ]NonCommercial)?(?:[- ]ShareAlike)?\s+(?:4\.0|3\.0)(?: International)?(?: License)?", re.I)


def openstax_licence_line(page_text: str) -> Optional[str]:
    """'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License' -> 'CC BY-NC-SA 4.0'; None if absent."""
    m = OPENSTAX_LICENCE.search(page_text)
    if not m:
        return None
    s = m.group(0).lower()
    ver = "4.0" if "4.0" in s else "3.0"
    return "CC BY" + ("-NC" if "noncommercial" in s else "") + ("-SA" if "sharealike" in s else "") + f" {ver}"


def fetch_openstax(h: Harvester, st: dict, it: dict, gm: dict, limit: int, recs: list) -> None:
    if not gm["openstax"]:
        raise Refused("no-source", "no OpenStax book is mapped to this subject")
    import lxml.html
    for book in gm["openstax"]:
        page_url = f"https://openstax.org/details/books/{book}"
        _, _, page = h.get(page_url, st)
        root = lxml.html.fromstring(page)
        lic = openstax_licence_line(root.text_content())
        if lic not in store.OPEN_LICENSES:
            raise Refused("licence-unknown", f"OpenStax {book}: licence line not found on its page, so it stays off.")
        st["openstax_licenses"][book] = lic            # recorded before anything from the book is stored
        root.make_links_absolute(page_url)
        pdfs = [a.get("href") for a in root.xpath("//a[@href]") if a.get("href", "").lower().split("?")[0].endswith(".pdf")]
        if not pdfs:
            raise Refused("network", f"OpenStax {book}: no PDF link on its page")
        _, _, pdf = h.get(pdfs[0], st, max_bytes=MAX_PDF)
        recs += _problems_to_records(pdf, it["topic"], gm["keywords"], it["tier"], it["unit"], f"OpenStax {book}", page_url, lic,
                                     book, "end-of-chapter", limit - len(recs))
        if len(recs) >= limit:
            break
    return


def fetch_stackexchange(h: Harvester, st: dict, it: dict, gm: dict, limit: int, recs: list) -> None:
    if not gm["se"]:
        raise Refused("no-source", "no Stack Exchange site is mapped to this subject")
    host = "api.stackexchange.com"
    for site in gm["se"]:
        day = h.today()
        if st["se_requests"]["date"] != day:
            st["se_requests"] = {"date": day, "n": 0}
        if st["se_requests"]["n"] >= SE_DAILY:
            raise Refused("quota", f"{SE_DAILY} Stack Exchange requests used today")
        url = (f"https://{host}/2.3/search/advanced?order=desc&sort=votes&q={quote(it['topic'])}&accepted=True&site={site}"
               f"&pagesize={min(30, max(5, limit * 2))}&filter=withbody")
        before = h.requests_made
        try:
            _, _, body = h.get(url, st, cache=True)
        finally:
            st["se_requests"]["n"] += h.requests_made - before      # network requests only; a cached page costs none
        try:
            data = json.loads(body.decode("utf-8"))
        except ValueError:
            raise Refused("network", "Stack Exchange answered something that is not JSON")
        if data.get("backoff"):
            st["backoff"][host] = h.clock() + float(data["backoff"])      # honoured: no request to the host until it passes
        if data.get("error_id"):
            raise Refused("rate-limit", f"Stack Exchange error {data.get('error_id')}: {data.get('error_name', '')}")
        for q in data.get("items") or []:
            text = html_to_text(q.get("body") or "")
            if not text or q.get("score", 0) < 1:
                continue
            title = htmllib.unescape(q.get("title") or "").strip()
            stem = f"{title}\n\n{text}".strip()
            if site in MATH_BACKSLASH_DOLLAR:
                # electronics.stackexchange writes inline maths as \$x\$; our renderer reads a backslash-dollar as a plain dollar sign.
                stem = stem.replace("\\$", "$")
            if len(stem) > store.MAX_TEXT or not matches_topic(stem, it["topic"], gm["keywords"]):
                continue
            created = int(q.get("creation_date") or 0)
            lic = q.get("content_license") or ("CC BY-SA 4.0" if created >= 1525219200 else "CC BY-SA 3.0")   # 2018-05-02: SE moved to 4.0
            owner = (q.get("owner") or {}).get("display_name") or "unknown"
            qid = q.get("question_id")
            recs.append({"origin": "cc-verbatim", "tier": it["tier"], "unit": it["unit"], "topic": it["topic"], "marks": guess_marks(stem),
                         "question": stem, "source": f"{site}.stackexchange.com question {qid} by {htmllib.unescape(owner)}, {lic}",
                         "source_url": q.get("link") or f"https://{site}.stackexchange.com/q/{qid}", "license": lic, "ref": f"{site} q{qid}"})
            if len(recs) >= limit:
                return
    return


_GATE_RANGE = re.compile(r"Q\.\s*(\d+)\s*[\u2013\u2014-]\s*Q\.\s*(\d+)\s+carry\s+(one|two)\s+marks?", re.I)
_GATE_Q = re.compile(r"^[ \t]*Q\.\s*(\d+)\b(?!\s*[–—-]\s*Q\.)", re.M)     # not the "Q.1 - Q.5 carry one mark" header lines
GATE_PAPERS = (("2026", "EC", "https://gate2026.iitg.ac.in/doc/download/2026/QPs/EC.pdf"),)


def fetch_gate_pointers(h: Harvester, st: dict, it: dict, gm: dict, limit: int, recs: list) -> None:
    """Which questions of the official paper are about the topic: year, paper, number, topic, marks, link.
    The PDF is read in memory for that and thrown away (cache=False); no question text is passed on."""
    if it["tier"] != "gate":
        raise Refused("no-source", "official GATE papers are only used for the gate tier")
    for year, paper, url in GATE_PAPERS:
        _, _, pdf = h.get(url, st, cache=False, max_bytes=MAX_PDF)
        text = pdf_text(pdf)
        del pdf
        marks_of = {}
        for a, b, w in _GATE_RANGE.findall(text):
            for n in range(int(a), int(b) + 1):
                marks_of[n] = 1.0 if w.lower() == "one" else 2.0
        qs = [(m.start(), m.group(1)) for m in _GATE_Q.finditer(text)]
        for i, (pos, num) in enumerate(qs):
            block = text[pos: qs[i + 1][0] if i + 1 < len(qs) else len(text)]
            if matches_topic(block, it["topic"], gm["keywords"]):
                recs.append({"origin": "pointer", "tier": "gate", "unit": it["unit"], "topic": it["topic"], "marks": marks_of.get(int(num), 1.0),
                             "source": f"GATE {year} {paper} (IIT Guwahati), pointer only", "source_url": url, "ref": f"GATE {year} {paper} Q{num}"})
                if len(recs) >= limit:
                    return
        del text
    return


FETCHERS: dict[str, Callable] = {"mit_ocw": fetch_mit_ocw, "openstax": fetch_openstax, "stackexchange": fetch_stackexchange,
                                 "gate_official": fetch_gate_pointers}


# ------------------------------------------------------------------ CLI
def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m jarvis_app.ww_harvest",
                                 description="Queue one topic and work the queue, politely, from the allowed sources.")
    ap.add_argument("--subject", help="subject id, e.g. control")
    ap.add_argument("--topic", help="topic to fetch for")
    ap.add_argument("--max", type=int, default=10, help="most records to add for the topic (default 10)")
    ap.add_argument("--tier", default="gate", choices=store.TIERS)
    ap.add_argument("--unit", type=int, default=None)
    ap.add_argument("--sources", default="", help="comma list from: " + ", ".join(ORDER))
    ap.add_argument("--requests", type=int, default=12, help="network request budget for this run (default 12)")
    ap.add_argument("--enable", action="store_true", help="switch the harvester on (it is off until you do)")
    ap.add_argument("--bank-dir", default="", help="a scratch bank folder (sets WW_BANK_DIR)")
    ap.add_argument("--status", action="store_true", help="print the sources and the queue, fetch nothing")
    a = ap.parse_args(argv)
    if a.bank_dir:
        os.environ["WW_BANK_DIR"] = a.bank_dir
    h = Harvester()
    if a.status or not (a.subject and a.topic):
        print(json.dumps({"sources": h.sources_view(), "queue": h.status()}, indent=1))
        return 0
    h.queue_topic(a.subject, a.topic, a.unit, a.tier, a.max, [s for s in a.sources.split(",") if s] or None)
    if a.enable:
        h.resume()
    out = h.run(a.requests)
    print(json.dumps(out, indent=1))
    print("on disk:", json.dumps(store.counts(a.subject)))
    return 0 if out.get("ran") else 2


if __name__ == "__main__":
    raise SystemExit(main())
