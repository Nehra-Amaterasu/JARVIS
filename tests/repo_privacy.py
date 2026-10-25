"""Scan every tracked file for personal data that must not be in a public repo.

    .venv\\Scripts\\python.exe tests\\repo_privacy.py          # print findings, exit 1 if any
    .venv\\Scripts\\python.exe -m pytest tests                 # the same as a test

What it looks for (constraints, Privacy):
  phone      a 10-digit Indian mobile number (+91 optional, "98xxx xxxxx" too)
  register   a university register number, J followed by nine digits
  name       a friend's or family member's name. The names are read at run time from
             the PRIVATE store (data/, git-ignored) and compared as SHA-256 hashes, so
             the names themselves are never written into the repo, this file included
  marks      a result phrase (backlog, failed, marks, grade, SGPA ...) on the same line
             as a subject code (KEC-501, BAS103 ...)
  key        a token: github_pat_/ghp_, AWS, Google API keys, sk-..., or a bare 64-hex
             string that is not labelled as a hash/checksum

A finding prints file:line, its kind and a short hash: never the value itself.
tests/privacy_allow.txt lists reviewed exceptions, one "<kind> <hash12>" per line.
"""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

ROOT = Path(__file__).resolve().parents[1]
ALLOW_FILE = Path(__file__).with_name("privacy_allow.txt")
MAX_BYTES = 3_000_000                       # bigger tracked files are data dumps, scanned anyway up to this

PATTERNS = {
    "phone": re.compile(r"(?<![\w.+/-])(?:\+91[\s-]?)?(?:[6-9]\d{9}|[6-9]\d{4}[\s-]\d{5})(?![\w/-])"),
    "register": re.compile(r"(?<![A-Za-z0-9])J\d{9}(?!\d)"),
    "key": re.compile(r"github_pat_[A-Za-z0-9_]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAKIA[0-9A-Z]{16}\b|"
                      r"\bAIza[0-9A-Za-z_-]{35}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
                      r"(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])"),
}
# A 64-hex string labelled as what it is (a model's checksum, a lockfile digest) is not a secret.
_HASH_LABEL = re.compile(r"sha-?256|sha256sum|checksum|digest|integrity|fingerprint|hash", re.I)
# Subject codes as the university prints them, and the words that make a line a result.
_SUBJECT = re.compile(r"\b(?:[A-Z]{2,4}-?\d{3}[A-Z]?|\d{2}[A-Z]{2,4}\d{2,3})\b")
_RESULT = re.compile(r"\b(?:backlogs?|back\s?papers?|carry[- ]?over|atkt|failed|fail(?:ed)?\s+in|re-?sits?|"
                     r"marks?\s+(?:scored|obtained|got)|scored|grade\s+[A-F][+]?|sgpa|cgpa|result)\b", re.I)
_WORD = re.compile(r"[A-Za-z][A-Za-z0-9._]{2,}")
# Words that are names in a chat list but ordinary words in a repo.
_STOP = {"the", "and", "you", "mom", "mum", "dad", "papa", "mummy", "bhai", "didi", "sir", "maam", "bro", "sis",
         "uncle", "aunty", "aunt", "chacha", "mama", "nana", "nani", "dadi", "dada", "group", "official", "class",
         "college", "team", "home", "family", "friends", "school", "office", "with", "from", "new", "old",
         # first scan, 10-23: chat-list display names made of everyday words ("Instagram
         # User" for a deleted account) matched 1,700 lines of ordinary English
         "its", "user", "instagram", "things", "happy"}


def h(text: str) -> str:
    return hashlib.sha256(text.strip().lower().encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    kind: str
    digest: str                              # sha256 of the matched value, first 12 hex

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.kind} [{self.digest}]"


def tracked_files(root: Path = ROOT) -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True).stdout
    return [p for p in out.decode("utf-8", "replace").split("\0") if p]


def private_dir(root: Path = ROOT) -> Optional[Path]:
    """The git-ignored private store: $JARVIS_PRIVATE_DATA, this checkout's data/, or
    (from a worktree) the main checkout's data/."""
    env = os.environ.get("JARVIS_PRIVATE_DATA")
    cands = [Path(env)] if env else []
    cands.append(root / "data")
    try:
        common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=root, capture_output=True,
                                text=True, check=True).stdout.strip()
        cands.append((root / common).resolve().parent / "data")
    except Exception:
        pass
    for c in cands:
        # A worktree's own data/ is often a stub the app made (data/aankhen only): the
        # store is the folder that really holds the people list or the identity facts.
        if (c / "yaadash" / "people.parquet").exists() or (c / "identity" / "core_facts.md").exists():
            return c
    return None


_RELATION = re.compile(r"\b(?:father|mother|brother|sister|mum|dad|papa|mummy|friend|girlfriend|boyfriend|cousin|"
                       r"uncle|aunt|grandfather|grandmother|name is|called)\b\W+(?:(?:is|was|named|called|my|his|her|"
                       r"the|a|an|best|close|elder|younger|older)\W+){0,3}((?:[A-Z][a-z]{2,}\s?){1,3})")


def private_names(store: Optional[Path]) -> tuple[set[str], set[str]]:
    """(hashes of names to find, hashes of his own name: never a finding). Empty when
    the private store is not on this machine (a fresh clone): the name check is skipped."""
    names: set[str] = set()
    own: set[str] = set()
    if store is None:
        return set(), set()

    def add(raw: str, into: set[str]) -> None:
        for t in re.split(r"[^A-Za-z]+", raw or ""):
            if len(t) >= 3 and t.lower() not in _STOP:
                into.add(h(t))
    people = store / "yaadash" / "people.parquet"
    if people.exists():
        try:
            import pandas as pd
            df = pd.read_parquet(people, columns=["name", "username", "is_group", "is_self", "n_msgs"])
            for r in df.itertuples():
                if r.is_self:
                    add(r.name, own)
                elif not r.is_group and (r.n_msgs or 0) >= 30:   # someone he really talked to
                    add(r.name, names)
                    if isinstance(r.username, str) and len(r.username) >= 4:
                        names.add(h(r.username))
        except Exception as e:                    # an unreadable store must not hide the other checks
            print(f"[privacy] people store unreadable: {e}", file=sys.stderr)
    facts = store / "identity" / "core_facts.md"
    if facts.exists():
        for m in _RELATION.finditer(facts.read_text(encoding="utf-8", errors="replace")):
            add(m.group(1), names)
    extra = store / "notes" / "privacy-terms.txt"   # anything else he wants kept out, one per line
    if extra.exists():
        for line in extra.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.startswith("#"):
                names.add(h(line))
    return names - own, own


def load_allow(path: Path = ALLOW_FILE) -> set[tuple]:
    """{(kind, hash12)} allowed anywhere, {(kind, hash12, path)} allowed in one file only."""
    allow = set()
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            parts = line.split("#")[0].split()
            if len(parts) >= 2:
                allow.add((parts[0], parts[1][:12]) + ((parts[2],) if len(parts) > 2 else ()))
    return allow


def allowed(f: Finding, allow: set) -> bool:
    return (f.kind, f.digest) in allow or (f.kind, f.digest, f.path) in allow


def pending(allow_path: Path = ALLOW_FILE) -> list[str]:
    """Allow-list lines marked PENDING: real personal data waiting for its owner to remove it."""
    if not allow_path.exists():
        return []
    return [ln.strip() for ln in allow_path.read_text(encoding="utf-8").splitlines() if "PENDING" in ln]


def scan_text(path: str, text: str, names: set[str]) -> Iterable[Finding]:
    prev = ""
    for n, line in enumerate(text.splitlines(), 1):
        label, prev = prev + " " + line, line          # "sha256" may sit on the line before the digest
        for kind, rx in PATTERNS.items():
            for m in rx.finditer(line):
                v = m.group(0)
                if kind == "key" and re.fullmatch(r"[0-9a-fA-F]{64}", v) and _HASH_LABEL.search(label):
                    continue
                yield Finding(path, n, kind, h(re.sub(r"[\s+-]", "", v))[:12])
        if _RESULT.search(line):
            for m in _SUBJECT.finditer(line):
                yield Finding(path, n, "marks", h(m.group(0) + " " + _RESULT.search(line).group(0))[:12])
        if names:
            seen = set()
            for m in _WORD.finditer(line):
                for t in {m.group(0)} | set(re.split(r"[._]+", m.group(0))):
                    d = h(t)
                    if len(t) >= 3 and d in names and d not in seen:
                        seen.add(d)
                        yield Finding(path, n, "name", d[:12])


def scan(root: Path = ROOT, files: Optional[list[str]] = None, names: Optional[set[str]] = None,
         allow: Optional[set] = None) -> list[Finding]:
    files = tracked_files(root) if files is None else files
    if names is None:
        names, _ = private_names(private_dir(root))
    allow = load_allow() if allow is None else allow
    out = []
    for rel in files:
        p = root / rel
        try:
            data = p.read_bytes()[:MAX_BYTES]
        except OSError:
            continue
        if b"\0" in data[:4096]:
            continue                              # binary (images, parquet, fonts)
        text = data.decode("utf-8", errors="replace")
        out.extend(f for f in scan_text(rel.replace("\\", "/"), text, names) if not allowed(f, allow))
    return out


def main() -> int:
    store = private_dir()
    names, _ = private_names(store)
    found = scan(names=names)
    print(f"[privacy] {len(tracked_files())} tracked files; names from the private store: "
          f"{len(names) if store else 'store not found, name check skipped'}")
    for f in found:
        print(f)
    for p in pending():
        print(f"[privacy] allowed for now, still to remove: {p}")
    print(f"[privacy] {len(found)} finding(s)")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
