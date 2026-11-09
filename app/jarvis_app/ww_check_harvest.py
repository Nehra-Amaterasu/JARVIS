"""Gate cases for the question harvester (docs/design/well-wisher-ui.md 8.5), on recorded fixtures, no network.

    python -m jarvis_app.ww_check_harvest      run the cases in a scratch folder; exit 1 if any fails
    run() -> {"cases": n, "problems": [...]}   the same, for ww_check.py and the tests

Also holds the test doubles the pytest files share (FakeNet, FakeClock, make_pdf), so the suite and the
gate exercise one set of recorded pages: app/tests/fixtures/harvest/. Nothing here opens a socket: the
harvester's transport is replaced by FakeNet, and the bank goes to a temporary folder (WW_BANK_DIR),
never the real data/.

The cases (each one a thing the harvester must never get wrong):
  1. a path robots.txt disallows is refused with that reason and the page is never requested;
  2. a second 403 or 429 from a host stops that host for the day (and the first is not retried);
  3. the queue survives a restart (a new Harvester over the same folder sees the same items);
  4. a source with no recorded licence is never fetched;
  5. every served item carries source, license and origin, and a pointer carries no stem text;
  6. a paper with a shortfall is served from disk and the missing topics are queued;
  7. one request at a time, paced 2 to 5 s apart, with a User-Agent that has no address.
"""
from __future__ import annotations

import json
import os
import random
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlparse

from . import ww_bank_store as store
from . import ww_generator, ww_harvest

FIX = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "harvest"
OCW_BASE = "https://ocw.mit.edu/courses/6-302-feedback-systems-spring-2007/"
OCW_PDF = OCW_BASE + "abc123_pset3.pdf"
OS_PAGE = "https://openstax.org/details/books/calculus-volume-3"
OS_PDF = "https://assets.openstax.org/oscms-prodcms/media/documents/Calculus_Volume_3.pdf"
GATE_PDF = ww_harvest.GATE_PAPERS[0][2]


def fx(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8")


def make_pdf(text: str) -> bytes:
    """A one-page PDF whose text layer is `text`, one line per line: enough for pdftotext, no PDF library.
    The page is 5000 pt wide so a long problem stays on one line (text past the page edge is dropped)."""
    lines = text.splitlines()
    esc = lambda s: s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    body = "BT /F1 9 Tf 10 %d Td 11 TL\n" % (len(lines) * 11 + 20) + "\n".join(f"({esc(ln)}) Tj T*" for ln in lines) + "\nET"
    stream = body.encode("latin-1", "replace")
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 5000 %d] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>" % (len(lines) * 11 + 40),
            b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offs = bytearray(b"%PDF-1.4\n"), []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    x = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
    return bytes(out)


class FakeClock:
    """A clock that only moves when the harvester sleeps, so pacing is measured, not waited for."""

    def __init__(self, t: float = 1_800_000_000.0):
        self.t, self.sleeps = t, []

    def now(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.sleeps.append(s)
        self.t += s


class FakeNet:
    """Recorded responses by exact URL or URL prefix; anything else is a 404. Tracks overlap (it must stay False)."""

    def __init__(self):
        self.exact: dict[str, Any] = {}
        self.prefix: list[tuple[str, Any]] = []
        self.calls: list[str] = []
        self.headers_seen: list[dict] = []
        self.busy = self.overlap = False
        self.on_call: Optional[Callable[[str], None]] = None

    def add(self, url: str, body: Any = b"", status: int = 200, headers: Optional[dict] = None) -> "FakeNet":
        self.exact[url] = (status, headers or {}, body.encode() if isinstance(body, str) else body)
        return self

    def add_prefix(self, prefix: str, body: Any, status: int = 200, headers: Optional[dict] = None) -> "FakeNet":
        self.prefix.insert(0, (prefix, (status, headers or {}, body.encode() if isinstance(body, str) else body)))     # the newest wins
        return self

    def hits(self, needle: str) -> int:
        return sum(1 for c in self.calls if needle in c)

    def __call__(self, url: str, headers: dict, timeout: float, max_bytes: int):
        if self.busy:
            self.overlap = True
        self.busy = True
        try:
            self.calls.append(url)
            self.headers_seen.append(headers)
            if self.on_call:
                self.on_call(url)
            if url in self.exact:
                return self.exact[url]
            for p, r in self.prefix:
                if url.startswith(p):
                    return r
            return 404, {}, b""
        finally:
            self.busy = False


def world(net: FakeNet, robots: str = "ok") -> FakeNet:
    """Every allowed host answers robots.txt; the pages are the recorded fixtures."""
    rtxt = fx("robots_block.txt") if robots == "block" else fx("robots_ok.txt")
    for host in ("ocw.mit.edu", "api.stackexchange.com", "openstax.org", "assets.openstax.org", "gate2026.iitg.ac.in"):
        net.add(f"https://{host}/robots.txt", rtxt)
    first, second = fx("ocw_pages.html").split("=====SPLIT=====")
    net.add(OCW_BASE, first).add(OCW_BASE + "pages/assignments/", second)
    net.add(OCW_PDF, make_pdf(fx("ocw_ps.txt")))
    net.add_prefix("https://api.stackexchange.com/2.3/search/advanced", fx("se_electronics.json"))
    net.add(OS_PAGE, fx("openstax_details.html")).add(OS_PDF, make_pdf(fx("openstax_ps.txt")))
    net.add(GATE_PDF, make_pdf(fx("gate_ec.txt")))
    return net


def harvester(net: FakeNet, clock: Optional[FakeClock] = None, day: Optional[list] = None, delay=(0.0, 0.0)) -> ww_harvest.Harvester:
    clock = clock or FakeClock()
    day = day or ["2026-11-09"]
    return ww_harvest.Harvester(transport=net, sleep=clock.sleep, clock=clock.now, today=lambda: day[0], delay=delay, rng=random.Random(1))


def pdf_reader_available() -> bool:
    return ww_harvest.find_pdftotext() is not None


# ------------------------------------------------------------------ the cases
def _scratch() -> tuple[str, Optional[str]]:
    d = tempfile.mkdtemp(prefix="ww-harvest-check-")
    old = os.environ.get("WW_BANK_DIR")
    os.environ["WW_BANK_DIR"] = d
    return d, old


def _restore(d: str, old: Optional[str]) -> None:
    if old is None:
        os.environ.pop("WW_BANK_DIR", None)
    else:
        os.environ["WW_BANK_DIR"] = old
    shutil.rmtree(d, ignore_errors=True)


def run() -> dict:
    problems: list[str] = []
    cases = 0

    def case(name: str, ok: bool, why: str = "") -> None:
        nonlocal cases
        cases += 1
        if not ok:
            problems.append(f"{name}: {why}" if why else name)

    # 1. robots.txt
    d, old = _scratch()
    try:
        net = world(FakeNet(), robots="block")
        h = harvester(net)
        h.queue_topic("control", "Routh-Hurwitz stability", tier="gate", max=5, sources=["mit_ocw"])
        h.resume()
        out = h.run(10)
        it = h.status()["items"][0]
        case("robots refusal", it["status"] == "refused" and it["reason_code"] == "robots" and "robots.txt" in it["reason"], str(it["reason"]))
        case("robots: page never requested", net.hits("/courses/") == 0 or all(c.endswith("robots.txt") for c in net.calls if "/courses/" in c), str(net.calls))
    finally:
        _restore(d, old)

    # 2. a second 403 or 429 stops the host for the day
    for code in (403, 429):
        d, old = _scratch()
        try:
            net = world(FakeNet())
            net.add_prefix("https://api.stackexchange.com/2.3/search/advanced", b"", status=code)
            h = harvester(net)
            h.queue_topic("control", "Routh-Hurwitz stability", sources=["stackexchange"])
            h.queue_topic("control", "Nyquist stability", sources=["stackexchange"])
            h.queue_topic("control", "Bode plot", sources=["stackexchange"])
            h.resume()
            h.run(20)
            se_calls = net.hits("/2.3/search/advanced")
            case(f"{code}: second one stops the host", se_calls == 2, f"{se_calls} API requests; wanted 2 (the third topic must not be asked)")
            reasons = [i["reason"] for i in h.status()["items"]]
            case(f"{code}: reason printed", all(f"HTTP {code}" in r or "left alone" in r for r in reasons), str(reasons))
            h.run(20)
            case(f"{code}: not retried the same day", net.hits("/2.3/search/advanced") == 2)
        finally:
            _restore(d, old)

    # 3. the queue survives a restart
    d, old = _scratch()
    try:
        h = harvester(world(FakeNet()))
        h.queue_topic("control", "Bode plot", tier="gate", max=7)
        h.pause()
        h2 = harvester(world(FakeNet()))
        s = h2.status()
        case("queue survives restart", len(s["items"]) == 1 and s["items"][0]["topic"] == "Bode plot" and s["paused"] is True and s["queued"] == 1, str(s))
    finally:
        _restore(d, old)

    # 4. no recorded licence, never fetched
    d, old = _scratch()
    saved = ww_harvest.SOURCES["mit_ocw"]["license"]
    try:
        ww_harvest.SOURCES["mit_ocw"]["license"] = None
        net = world(FakeNet())
        h = harvester(net)
        h.queue_topic("control", "Routh-Hurwitz stability", sources=["mit_ocw"])
        h.resume()
        h.run(10)
        it = h.status()["items"][0]
        case("no licence, no fetch", net.calls == [] and it["reason_code"] == "licence-unknown" and "licence not recorded" in it["reason"], str(net.calls))
        row = next(r for r in h.sources_view()["sources"] if r["id"] == "mit_ocw")
        case("no licence: source row is off with the reason", row["status"] == "off" and "licence not recorded" in row["reason"], str(row))
    finally:
        ww_harvest.SOURCES["mit_ocw"]["license"] = saved
        _restore(d, old)

    # 5 and 7. what is served carries its source line; a pointer has no stem; politeness
    d, old = _scratch()
    try:
        clock = FakeClock()
        net = world(FakeNet())
        h = harvester(net, clock, delay=(2.0, 5.0))
        h.queue_topic("control", "Routh-Hurwitz stability", unit=3, tier="gate", max=20)
        h.resume()
        h.run(30)
        served = store.load_for("control")
        case("something was fetched", len(served) >= 3, f"{len(served)} records")
        for q in served:
            miss = [k for k in ("source", "license", "origin") if not q.get(k)]
            if miss:
                case("served item has source, license, origin", False, f"{q.get('id')} lacks {miss}")
                break
        else:
            case("served item has source, license, origin", True)
        ptr = [q for q in store.all_records("control") if q["origin"] == "pointer"]
        case("pointers present", bool(ptr), "no pointer record from the GATE paper")
        case("pointer has no stem", all("question" not in q for q in ptr), "a pointer record stored text")
        raw = " ".join(p.read_text(encoding="utf-8") for p in (Path(d) / "control").glob("gate_official.jsonl"))
        case("pointer file holds no question text", "Which of the following" not in raw and "matched filter" not in raw.lower(), raw[:120])
        case("one request at a time", net.overlap is False)
        waits = clock.sleeps
        case("paced 2 to 5 s", bool(waits) and all(2.0 - 1e-9 <= w <= 5.0 + 1e-9 for w in waits), str(waits))
        ua = {h_["User-Agent"] for h_ in net.headers_seen}
        case("User-Agent names the project, no address", len(ua) == 1 and "JARVIS" in next(iter(ua)) and "@" not in next(iter(ua)), str(ua))
        gate_cache = Path(d) / "_harvest" / "cache" / "gate2026.iitg.ac.in"
        case("GATE pdf never cached", not gate_cache.exists() or not any(gate_cache.iterdir()), "a GATE body is on disk")
        case("openly licensed PDFs are cached", any((Path(d) / "_harvest" / "cache" / "ocw.mit.edu").glob("*.body")) or not pdf_reader_available())
    finally:
        _restore(d, old)

    # 6. a shortfall: served from disk, missing topics queued
    d, old = _scratch()
    try:
        store.add("control", [{"origin": "cc-verbatim", "tier": "gate", "unit": 1, "topic": "Routh-Hurwitz", "marks": 5, "source": "Fixture course, CC BY-SA 4.0",
                               "source_url": "https://example.org/q1", "license": "CC BY-SA 4.0", "ref": "fx 1",
                               "question": "Fictional question about the Routh-Hurwitz criterion for a cubic polynomial."}], "stackexchange")
        units = [{"n": 1, "title": "Stability", "exam_weight": "high", "topics": ["Routh-Hurwitz", "Nyquist criterion"]}]
        exam = {"id": "x", "subject": "control", "title": "X", "units": [], "max": 10,
                "pattern": [{"name": "A", "questions": 3, "attempt": 3, "marks": 5}]}
        paper = ww_generator.generate(exam, [], units, {}, {}, seed=1, tier="gate")
        case("paper served from disk", paper["bank_size"] == 1 and paper["tier"] == "gate" and paper["empty"] is False, str({k: paper[k] for k in ("bank_size", "tier", "empty")}))
        case("shortfall reported", bool(paper["shortfall"]))
        h = harvester(world(FakeNet()))
        queued = h.queue_missing_topics("control", units, [], tier="gate", want=1)
        case("missing topics queued", [q["topic"] for q in queued] == ["Nyquist criterion"], str([q["topic"] for q in queued]))
        again = h.queue_missing_topics("control", units, [], tier="gate", want=1)
        case("queueing twice does not duplicate", len(h.status()["items"]) == 1 and len(again) == 1)
    finally:
        _restore(d, old)

    return {"cases": cases, "problems": problems, "pdf_reader": pdf_reader_available()}


def main() -> int:
    r = run()
    print(json.dumps(r, indent=1))
    return 0 if not r["problems"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
