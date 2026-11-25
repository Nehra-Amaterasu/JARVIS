"""The GATE organiser's download page: the question paper and the answer key of each subject, year by year.

Read by hand on 25 Nov 2026 (one request; no paper fetched): the page links every file under static/doc/download/,
402 such links, the paper and the key of each subject for 2021 to 2026. The file names follow no rule across years
(EC.pdf, EC2025.pdf, EC24S7.pdf, ec_2023.pdf; keys under Keys/, 2025_Key/, Answer_keys2023/), so nothing is built:
a file is only ever an address this page printed. The page ends "All Rights Reserved" and names no licence, its
robots.txt answers 404 (RFC 9309: no rules), and it carries one hidden link to a random address, which is skipped.
The years before 2021 are offered there only as a shared folder on another service: that is not this source.

The organising institute changes every year and so does the host: LISTING and HOSTS are the 2027 cycle's.
"""
from __future__ import annotations

import re
from urllib.parse import urljoin

from . import Adapter, _html, register

LISTING = "https://gate2027.iitm.ac.in/download"
HOSTS = ("gate2027.iitm.ac.in",)
_FILE = re.compile(r"^/?static/doc/download/([A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_-]+)*\.pdf)$", re.I)


def parse(page: bytes, base: str) -> dict:
    s = page.decode("utf-8", "replace")
    items, unseen = [], 0
    for attrs, inner in _html.A_FULL.findall(s):
        h = _html.href(attrs)
        m = _FILE.match(h or "")
        if not m:
            continue
        if _html.hidden(attrs):
            unseen += 1
            continue
        rest = m.group(1)
        name = rest.rsplit("/", 1)[-1]
        if not re.match(r"[A-Za-z]{2}", name):
            continue
        code = name[:2].upper()
        ym = re.search(r"20\d\d", rest)
        year = int(ym.group(0)) if ym else None
        kind = "key" if re.search(r"key|ans", rest, re.I) else "paper"
        label = _html.text(inner)
        title = f"GATE {year or ''} {code} {'answer key' if kind == 'key' else 'question paper'}".replace("  ", " ")
        if label and label.upper() != code and kind == "paper":
            title += f": {label}"
        items.append({"title": title, "code": code, "year": year, "kind": kind, "url": urljoin(base, h)})
    return {"items": items, "note": f"{unseen} hidden {'link was' if unseen == 1 else 'links were'} skipped" if unseen else ""}


register(Adapter(
    id="gate_papers", name="GATE question papers and answer keys (the organiser's download page)", listing=LISTING, hosts=HOSTS, parse=parse,
    rights="All Rights Reserved (the page's own line; no licence is named)",
    terms_note="Read on 25 Nov 2026: the page says All Rights Reserved and names no licence; robots.txt answers 404, which is read as no rules. "
               "So a fetch is a pointer to the paper. A local copy is your second switch, for your own study on this PC, and is never passed on."))
