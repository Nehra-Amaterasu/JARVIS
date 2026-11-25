"""Paper sources of the harvester: whole past papers from a publisher's own listing page (plan 9.0, 25 Nov 2026).

    register(adapter)                        an adapter module adds itself by one line
    view(h) / view_one(st, sid)              every paper source with its two switches and the reason in words
    set_switches(h, sid, changes)            R-44: on, local_copy, address
    index(h, sid, q, code, refresh)          R-53: what the publisher lists (asked once a day at most)
    fetch(h, sid, key)                       R-54: a pointer (no request), or a local copy with the second switch
    dropin(h, path)                          R-45: a file he downloaded himself joins the manifest
    manifest(h, source)                      R-43: where every file and pointer came from

An adapter is a parser and nothing else. It is handed the bytes of a listing page that the Harvester fetched and
returns the lines it reads there: it opens no socket, builds no address and follows no link. Two listing pages read
by hand on 25 Nov 2026 decided that: one carries a hidden link that looks like a trap for crawlers, and the other
names its files differently every year, so an address is only ever one the page itself printed, on the source's own
host. Every politeness rule (robots, one request at a time, 3 s a host, 200 a host a day, backoff, the stop on a
second refusal) is ww_harvest.Harvester's.

Every source is off until he switches it on, and a source without a terms note cannot be switched on. A local
copy is a second switch: without it a fetch writes a pointer line and asks the network nothing. A local copy lives
under the private data directory (_harvest/papers/<source>/) and goes to the paper desk like a dropped file; it is
never a record of the question bank, whose store refuses third-party text.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlparse

from .. import ww_harvest as wh
from ..ww_pyq import api

MAX_ITEMS = 5000                  # lines kept of one listing page: the largest page read by hand had 679
MAX_LISTING = 4 * 1024 * 1024     # bytes of a listing page handed to a parser (the two read by hand: 337 KB and 184 KB)
_SID = re.compile(r"^[a-z][a-z0-9_]{1,30}$")
_KEY = re.compile(r"^[0-9a-f]{12}$")
_NET_KEYS = ("last_request_at", "host_counts", "host_blocks", "blocked_urls", "backoff")
_mlock = threading.Lock()


@dataclass(frozen=True)
class Adapter:
    id: str
    name: str
    rights: str                                   # what the publisher says of its files, in its own words where it has any
    terms_note: str                               # what was read of its terms; empty means the source cannot be switched on
    parse: Callable[[bytes, str], dict]           # (page, its address) -> {"items": [{title, code, year, kind, url, note?}], "note": str}
    listing: str = ""                             # the listing page; "" when the address is his to give
    hosts: tuple = ()                             # the only hosts a listing or a file may come from; () means the address's own host
    needs_address: bool = False


ADAPTERS: dict[str, Adapter] = {}


class Off(Exception):
    """The source is switched off: nothing is asked of it."""


class NeedsAddress(Exception):
    """The source's listing page is his to name, and he has not yet."""


def register(a: Adapter) -> None:
    if not _SID.match(a.id) or a.id in wh.SOURCES or a.id == "manual":
        raise ValueError(f"not a usable source id: {a.id!r}")
    if not a.needs_address and (not a.listing or not a.hosts or urlparse(a.listing).hostname not in a.hosts):
        raise ValueError(f"{a.id}: a source with its own listing page names that page and its hosts")
    ADAPTERS[a.id] = a


def key_of(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]


def check_address(raw) -> str:
    """A listing page he names: a public site by name, plain http(s), no login. Not this PC and not the home network,
    so the address cannot be used to make the app read something only this PC can reach."""
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 500:
        raise ValueError("Give the address of the listing page, starting with https://.")
    url = raw.strip()
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
        raise ValueError("Give a plain http or https address without a login.")
    host = p.hostname.lower()
    if "." not in host or host == "localhost" or host.endswith((".local", ".localhost", ".internal", ".lan", ".home")):
        raise ValueError("Give a public site, not this PC or the home network.")
    if re.fullmatch(r"[0-9.]+", host):
        raise ValueError("Give the site by its name, not by a number.")
    return url


# ------------------------------------------------------------------ the two switches
def _address(a: Adapter, sw: dict) -> Optional[str]:
    return (sw.get("address") or None) if a.needs_address else a.listing


def _hosts(a: Adapter, address: Optional[str]) -> tuple:
    return tuple(a.hosts) or ((urlparse(address).hostname,) if address else ())


def view_one(st: dict, sid: str) -> dict:
    a = ADAPTERS[sid]
    sw = st["paper_sources"].get(sid, {})
    on = bool(sw.get("on")) and bool(a.terms_note)
    local = on and bool(sw.get("local_copy"))
    address = _address(a, sw)
    if not a.terms_note:
        reason = "This source has no terms note; it stays off."
    elif not on:
        reason = "Off. Read the terms note, then switch it on."
    elif not address:
        reason = "Give the address of the listing page first."
    elif local:
        reason = "On, with a local copy: a fetched paper is kept on this PC and read at the paper desk."
    else:
        reason = "On, pointers only: a fetch writes where the paper is and asks the site nothing."
    return {"id": sid, "name": a.name, "kind": "papers", "rights": a.rights, "terms_note": a.terms_note, "hosts": list(_hosts(a, address)),
            "needs_address": a.needs_address, "address": address, "on": on, "local_copy": local, "reason": reason}


def view(h) -> list[dict]:
    st = h.load()
    return [view_one(st, sid) for sid in ADAPTERS]


def set_switches(h, sid: str, changes) -> dict:
    if sid in wh.SOURCES:
        raise ValueError("This source follows the harvester's own switch.")
    if sid not in ADAPTERS:
        raise KeyError("No such source.")
    if not isinstance(changes, dict) or not changes or set(changes) - {"on", "local_copy", "address"}:
        raise ValueError("Send on, local_copy or address.")
    for k in ("on", "local_copy"):
        if k in changes and not isinstance(changes[k], bool):
            raise ValueError(f"{k} is true or false.")
    a = ADAPTERS[sid]
    with h._lock:
        st = h.load()
        sw = dict(st["paper_sources"].get(sid, {}))
        if "address" in changes:
            if not a.needs_address:
                raise ValueError("This source has its own listing page; it takes no address.")
            sw["address"] = "" if changes["address"] in (None, "") else check_address(changes["address"])
        if "on" in changes:
            if changes["on"] and not a.terms_note:
                raise ValueError("This source has no terms note; it stays off.")
            sw["on"] = changes["on"]
            if not sw["on"]:
                sw["local_copy"] = False             # the second switch never outlives the first
        if "local_copy" in changes:
            if changes["local_copy"] and not sw.get("on"):
                raise ValueError("Switch the source on first; a local copy is the second switch.")
            sw["local_copy"] = changes["local_copy"]
        st["paper_sources"][sid] = sw
        h.save(st)
        return view_one(st, sid)


def _ready(st: dict, sid: str) -> tuple[Adapter, str, tuple]:
    if sid not in ADAPTERS:
        raise KeyError("No such source.")
    a = ADAPTERS[sid]
    sw = st["paper_sources"].get(sid, {})
    if not (sw.get("on") and a.terms_note):
        raise Off("This source is off.")
    address = _address(a, sw)
    if not address:
        raise NeedsAddress("Give the address of the listing page first.")
    return a, address, _hosts(a, address)


def wants_local(h, sid: str) -> bool:
    st = h.load()
    _ready(st, sid)
    return bool(st["paper_sources"].get(sid, {}).get("local_copy"))


# ------------------------------------------------------------------ small files
def _read_json(f: Path):
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(f: Path, data: bytes) -> None:
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, f)


def _keep_net(h, st: dict) -> None:
    """What a request changed (the counts, a refusal, a backoff) is written into the state as it is now, so a switch
    he pressed while the request was out is not undone by an older copy."""
    with h._lock:
        cur = h.load()
        for k in _NET_KEYS:
            cur[k] = st[k]
        h.save(cur)


def _robots_date(h, url: str) -> Optional[str]:
    rec = _read_json(h.root / "robots" / f"{re.sub(r'[^a-z0-9.-]', '_', urlparse(url).hostname or '')}.json")
    return rec.get("date") if isinstance(rec, dict) else None


# ------------------------------------------------------------------ the listing
def _listing_path(h, sid: str) -> Path:
    return h.root / "listings" / f"{sid}.json"


def listing(h, sid: str, refresh: bool = False) -> dict:
    """What the publisher lists, read once a day at most; `refresh` asks again with a conditional request."""
    st = h.load()
    a, address, hosts = _ready(st, sid)
    f = _listing_path(h, sid)
    old = _read_json(f) or {}
    if old.get("address") != address:
        old = {}
    if old.get("date") == h.today() and not refresh:
        return old
    if not h._run_lock.acquire(blocking=False):
        raise api.Busy("The harvester is fetching; wait for it.")
    try:
        try:
            status, headers, body = h.get_fresh(address, st, old.get("etag", ""), old.get("last_modified", ""), MAX_LISTING, hosts)
        finally:
            _keep_net(h, st)
    finally:
        h._run_lock.release()
    if status == 304:
        if "items" not in old:
            raise wh.Refused("network", "the site said the page has not changed, but no earlier reading is on file")
        rec = {**old, "date": h.today(), "read_at": h._iso()}
    else:
        parsed = a.parse(body[:MAX_LISTING], address)
        items, seen = [], set()
        for it in parsed.get("items") or []:
            url = str(it.get("url") or "")
            p = urlparse(url)
            if p.scheme not in ("http", "https") or p.hostname not in hosts or p.username or url in seen or len(items) >= MAX_ITEMS:
                continue                       # an address off the source's own host is never listed, so it can never be fetched
            seen.add(url)
            row = {"key": key_of(url), "title": str(it.get("title") or "")[:200], "code": str(it.get("code") or "")[:20],
                   "year": it.get("year") if isinstance(it.get("year"), int) else None,
                   "kind": it.get("kind") if it.get("kind") in ("paper", "key") else "paper", "url": url}
            if it.get("note"):
                row["note"] = str(it["note"])[:200]
            items.append(row)
        rec = {"date": h.today(), "read_at": h._iso(), "address": address, "etag": str(headers.get("etag") or ""),
               "last_modified": str(headers.get("last-modified") or ""), "items": items, "note": str(parsed.get("note") or "")[:300]}
    _write(f, json.dumps(rec, ensure_ascii=False).encode("utf-8"))
    return rec


def index(h, sid: str, q: str = "", code: str = "", refresh: bool = False) -> dict:
    if len(q or "") > 80 or len(code or "") > 20:
        raise ValueError("The search is at most 80 characters and a code 20.")
    rec = listing(h, sid, refresh)
    have = {m.get("url") for m in manifest(h, sid)}
    words = re.findall(r"[a-z0-9]+", (q or "").lower())
    want = (code or "").strip().lower()
    rows = []
    for it in rec["items"]:
        hay = f"{it['title']} {it['code']}".lower()
        if (want and it["code"].lower() != want) or any(w not in hay for w in words):
            continue
        rows.append({**it, "on_file": it["url"] in have})
    return {"items": rows, "listed": len(rec["items"]), "read_at": rec["read_at"], "note": rec.get("note", "")}


# ------------------------------------------------------------------ the manifest
def _manifest_path(h) -> Path:
    return h.root / "manifest.jsonl"


def manifest(h, source: Optional[str] = None) -> list[dict]:
    """Every line, oldest first. One line per file (by hash) or per pointer (by source and address)."""
    out = []
    try:
        lines = _manifest_path(h).read_text(encoding="utf-8").splitlines()
    except OSError:
        return out
    for line in lines:
        try:
            m = json.loads(line)
        except ValueError:
            continue
        if isinstance(m, dict) and (not source or m.get("source") == source):
            out.append(m)
    return out


def _put(h, entry: dict) -> dict:
    """Add a line unless it is on file: the same file twice is one line, and a file replaces the pointer to it."""
    with _mlock:
        rows = manifest(h)
        if entry.get("sha256"):
            same = next((m for m in rows if m.get("sha256") == entry["sha256"]), None)
            if same is not None:
                return same
            rows = [m for m in rows if not (not m.get("sha256") and m.get("source") == entry["source"] and m.get("url") and m.get("url") == entry.get("url"))]
        else:
            same = next((m for m in rows if m.get("source") == entry["source"] and m.get("url") == entry.get("url")), None)
            if same is not None:
                return same
        rows.append(entry)
        _write(_manifest_path(h), ("\n".join(json.dumps(m, ensure_ascii=False) for m in rows) + "\n").encode("utf-8"))
        return entry


# ------------------------------------------------------------------ a pointer, or a local copy
def fetch(h, sid: str, key) -> tuple[dict, Optional[Path]]:
    """The manifest line of one listed paper and, with the local copy switched on, the file it was saved to."""
    st = h.load()
    a, address, hosts = _ready(st, sid)
    if not isinstance(key, str) or not _KEY.match(key):
        raise KeyError("No such paper in the listing.")
    rec = _read_json(_listing_path(h, sid)) or {}
    it = next((i for i in rec.get("items") or [] if i.get("key") == key), None) if rec.get("address") == address else None
    if it is None:
        raise KeyError("No such paper in the listing; read the listing first.")
    base = {"source": sid, "key": key, "title": it["title"], "url": it["url"], "fetched": h._iso(), "terms_note": a.terms_note,
            "rights": a.rights, "paper_id": None}
    if not st["paper_sources"].get(sid, {}).get("local_copy"):
        return _put(h, {**base, "bytes": None, "sha256": None, "robots_checked": None, "local": "pointer only"}), None
    if not h._run_lock.acquire(blocking=False):
        raise api.Busy("The harvester is fetching; wait for it.")
    try:
        try:
            _, _, body = h.get(it["url"], st, cache=False, max_bytes=wh.MAX_PDF, allow_hosts=hosts)
        finally:
            _keep_net(h, st)
    finally:
        h._run_lock.release()
    if b"%PDF-" not in body[:1024]:
        raise wh.Refused("network", "the site did not answer with a PDF; nothing was kept")
    sha = hashlib.sha256(body).hexdigest()
    f = h.root / "papers" / sid / f"{sha[:16]}.pdf"
    if not f.exists():
        _write(f, body)
    entry = _put(h, {**base, "bytes": len(body), "sha256": sha, "robots_checked": _robots_date(h, it["url"]),
                     "local": f"_harvest/papers/{sid}/{f.name}"})
    return entry, f


def dropin(h, path: Path) -> dict:
    """A file he downloaded himself: the same manifest, source "manual". The file stays where he put it."""
    sha, size = hashlib.sha256(), 0
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            sha.update(chunk)
            size += len(chunk)
    digest = sha.hexdigest()
    return _put(h, {"source": "manual", "key": digest[:12], "title": path.name[:200], "url": "", "fetched": h._iso(), "bytes": size,
                    "sha256": digest, "robots_checked": None, "terms_note": "A file you downloaded yourself.", "rights": "yours to judge",
                    "local": str(path), "paper_id": None})


from . import gate_papers, papers_table  # noqa: E402,F401  (each registers itself by one line)
