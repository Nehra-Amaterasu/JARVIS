"""The evidence ledger (plan 9.0, wave EW10, package KA): one append-only file of dated lines, each a
commit, a certificate, an artefact, a test, a session or a witness, that later packages cite.

    Ledger(root, files_root).lines()                 -> (lines, skipped)   every line on file, removals applied
    Ledger.add(raw, today)                           -> the new line        K-02, every refusal a ValueError
    Ledger.remove(id, today)                         -> the line, removed   K-03, the line stays on file
    Ledger.add_many(records)                         -> (added, already)    K-04, one write for a whole import
    view(line, files_root)                           -> the line as K-01 answers it, with `hard`
    import_commits(ledger, repos, names, today)      -> K-04, local git only (github_activity.local_commits)
    xp_check(plan_state, inputs, today)              -> both XP numbers, neither rule changed

Why append-only: a line he filed is proof, and proof that can be edited away is not proof. A removal is a
second line ({"op": "remove"}), so the first stays on file and a later audit can still read it. Every write
rewrites the whole file through a temporary file and os.replace, so a crash mid-write leaves the old file whole
(the ledger never holds a half line); a line that does not parse is skipped and named, never a crash.

`hard` is computed at read time, not stored: a link that is http(s), or a file that still exists inside his
private data directory. A file he later deletes makes its line soft again, which is the point of the word.
Nothing here is scored by a model and nothing contacts the network: the only process started is local git
(log and rev-parse, both read-only).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import threading
import time
from datetime import date
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlparse

from . import github_activity, paths, ww_engines
from .ww_pyq.api import Busy as _ApiBusy

SCHEMA_VERSION = 1
KINDS: tuple[str, ...] = ("artefact", "commit", "certificate", "test", "session", "witness")
SOURCES: tuple[str, ...] = ("typed", "git")
MAX_TITLE = 200            # the contract's cap; a commit subject longer than this is cut, a typed one refused
MAX_LINK = 400             # the same ceiling germoney.add_attribute keeps for a link
MAX_NODES = 20
MAX_REPOS = 10             # normalize_inputs keeps at most 10 work repos
# A commit import reads ten years back, newest first, and keeps at most 2000 a repository a run: a 50 000 commit
# history would otherwise put one line a commit into a file read on every K-01. Older ones stay unread, and the
# answer says how many were left.
IMPORT_DAYS = 3650
IMPORT_CAP = 2000
MAX_GIT_CONFIG = 256 * 1024   # a repository config is a few hundred bytes; a bigger one is refused, not read
# Section names are case-free in git ("[Include]", "[includeIf \"gitdir:...\"]"), so the match is too.
_INCLUDE = re.compile(r"^\s*\[\s*include(if)?\b", re.I | re.M)
GIT_TIMEOUT_S = 10        # the same as local_commits: a repository on a sleeping disk must not hang the route
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_NODE = re.compile(r"^[A-Za-z0-9_.:-]{1,60}$")
_ID = re.compile(r"^[ec]-[0-9a-f]{16}$")
_SHA = re.compile(r"^[0-9a-f]{40}([0-9a-f]{24})?$")    # sha-1, or sha-256 in a repository that uses it


class Busy(_ApiBusy):
    """One commit import at a time (a subclass of the pyq Busy, so api.guard answers it 409)."""


def default_root() -> Path:
    """Where the ledger file lives: paths.DATA / "evidence" (paths.DATA follows JARVIS_DATA_DIR, so a test never
    writes into his real ledger)."""
    return Path(paths.DATA) / "evidence"


def files_root() -> Path:
    """His private data directory: a file given in K-02 must lie inside it after links and junctions resolve."""
    return Path(paths.DATA)


def _day(v: Any, what: str) -> str:
    if not isinstance(v, str) or not _DATE.match(v.strip()):
        raise ValueError(f"{what} must be a date like 2026-11-27.")
    try:
        return date.fromisoformat(v.strip()).isoformat()
    except ValueError:
        raise ValueError(f"{what} is not a real date.") from None


def parse_day(v: Optional[str], what: str) -> Optional[str]:
    if v is None or not str(v).strip():
        return None
    return _day(str(v), what)


def _plain(text: str) -> str:
    """His text, kept as text: control characters become spaces and runs of space collapse. It is stored and
    answered, never executed, never used as a path or a command."""
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", text)).strip()


def check_link(v: Any) -> Optional[str]:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if not isinstance(v, str):
        raise ValueError("A link must be text.")
    s = v.strip()
    if len(s) > MAX_LINK:
        raise ValueError(f"A link is at most {MAX_LINK} characters.")
    if not _site_link(s):
        raise ValueError("A link must start with http:// or https:// and name a site, with no password in it.")
    return s


def _site_link(s: str) -> bool:
    """http(s), a real host name, no user or password, no space or control character. A bare netloc test let
    "https://@/" and "https://:443/" count as hard with no site at all, and a password in a link would be
    printed on every K-01 and later on a CV (review of 2026-11-27)."""
    if re.search(r"[\s\x00-\x1f\x7f]", s):
        return False
    try:
        u = urlparse(s)
        host = u.hostname
        _ = u.port                      # an unreadable port ("https://h:x/") raises here
    except ValueError:
        return False
    return u.scheme.lower() in ("http", "https") and bool(host) and u.username is None and u.password is None


def _is_network_or_device(text: str) -> bool:
    # UNC, extended-length and device paths all start with two separators: on Windows exists() or resolve() on a
    # UNC name opens an SMB connection to that host and offers his login to it before any check could say no
    # (the same reason as routes_ww_pyq_ingest.check_path), so this runs before the path is touched at all.
    return text.replace("/", "\\").startswith("\\\\")


def check_file(v: Any, root: Path, ledger_root: Optional[Path] = None) -> Optional[str]:
    """A file inside his private data directory, answered relative to it with forward slashes: never an absolute
    path, which would carry his user name into every answer. Nothing in the ledger's own folder counts: the
    ledger file always exists, so naming it would make any claim hard."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if not isinstance(v, str):
        raise ValueError("A file must be given as its path.")
    text = v.strip().strip('"').strip("'")
    if _is_network_or_device(text):
        raise ValueError("Give a file on this PC, not a network or device path.")
    if ":" in text[2:] or (":" in text[:2] and not re.match(r"^[A-Za-z]:", text)):
        raise ValueError("That is not a plain file path.")       # an alternate data stream (name:stream) or a stray colon
    base = Path(root).resolve()
    p = Path(text)
    p = p if p.is_absolute() else base / p
    try:
        real = p.resolve(strict=True)        # follows symbolic links and junctions before the inside test below
    except (OSError, RuntimeError):
        raise ValueError("There is no file at that path.") from None
    try:
        rel = real.relative_to(base)
    except ValueError:
        raise ValueError("The file must be inside your private data folder.") from None
    if ledger_root is not None:
        led = Path(ledger_root).resolve()
        if real == led or led in real.parents:
            raise ValueError("A file in the evidence ledger's own folder is not proof of anything; give the file itself.")
    if not real.is_file():
        raise ValueError("That is a folder; give one file.")
    return rel.as_posix()


def file_exists(rel: Optional[str], root: Path) -> bool:
    """Whether a stored relative file still exists inside the root (a hand-edited line pointing out is soft)."""
    if not rel or not isinstance(rel, str) or _is_network_or_device(rel) or Path(rel).is_absolute():
        return False
    base = Path(root).resolve()
    try:
        real = (base / rel).resolve(strict=True)
        real.relative_to(base)
    except (OSError, RuntimeError, ValueError):
        return False
    return real.is_file()


def _node_ids(v: Any) -> list[str]:
    if v is None:
        return []
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        raise ValueError("node_ids must be a list of node ids.")
    out = []
    for x in v:
        x = x.strip()
        if not _NODE.match(x):
            raise ValueError("A node id is letters, digits, dots, colons, dashes or underscores, at most 60.")
        if x not in out:
            out.append(x)
    if len(out) > MAX_NODES:
        raise ValueError(f"At most {MAX_NODES} nodes a line.")
    return out


def commit_id(repo: str, sha: str) -> str:
    """The same repository name and hash give the same id, so a second import adds nothing."""
    return "c-" + hashlib.sha256(f"{repo}\x1f{sha}".encode("utf-8")).hexdigest()[:16]


def valid_id(eid: Any) -> bool:
    return isinstance(eid, str) and bool(_ID.match(eid))


# ------------------------------------------------------------------ the file
class Ledger:
    def __init__(self, root: Optional[Path] = None, files: Optional[Path] = None):
        self.root = Path(root) if root is not None else default_root()
        self.files = Path(files) if files is not None else files_root()
        self.path = self.root / "evidence.jsonl"
        self._lock = threading.RLock()
        self._import = threading.Lock()

    # ---- read
    def _raw_lines(self) -> list[str]:
        # Under the write lock: on Windows os.replace onto a file another handle has open fails with WinError 5,
        # so a K-01 read racing a K-02 write turned the write into a 500 (review of 2026-11-27).
        with self._lock:
            try:
                return self.path.read_text(encoding="utf-8").splitlines()
            except FileNotFoundError:
                return []

    def lines(self) -> tuple[list[dict], list[dict]]:
        """Every added line in file order with removals applied (`removed`, `removed_on`), and the lines skipped."""
        added: dict[str, dict] = {}
        order: list[str] = []
        skipped: list[dict] = []
        for n, text in enumerate(self._raw_lines(), start=1):
            if not text.strip():
                continue
            try:
                rec = json.loads(text)
            except ValueError:
                skipped.append({"line": n, "reason": "This line does not read as JSON; it was left out."})
                continue
            if not isinstance(rec, dict) or not isinstance(rec.get("v"), int) or rec.get("op") not in ("add", "remove"):
                skipped.append({"line": n, "reason": "This line is not an evidence line (v, op); it was left out."})
                continue
            if rec["v"] > SCHEMA_VERSION:
                skipped.append({"line": n, "reason": f"This line was written by a newer version (schema {rec['v']}); it was left out."})
                continue
            eid = rec.get("id")
            if rec["op"] == "remove":
                if eid in added and not added[eid]["removed"]:
                    added[eid]["removed"] = True
                    added[eid]["removed_on"] = rec.get("at") if isinstance(rec.get("at"), str) else None
                elif eid not in added:
                    skipped.append({"line": n, "reason": "This removal names a line that is not on file; it was left out."})
                continue
            ok = (valid_id(eid) and rec.get("kind") in KINDS and isinstance(rec.get("title"), str)
                  and isinstance(rec.get("at"), str) and _DATE.match(rec["at"]) is not None)
            if not ok:
                skipped.append({"line": n, "reason": "This line lacks an id, a kind, a title or a date; it was left out."})
                continue
            if eid in added:
                skipped.append({"line": n, "reason": "A second line with the same id; the first one counts."})
                continue
            added[eid] = {**rec, "removed": False, "removed_on": None}
            order.append(eid)
        return [added[i] for i in order], skipped

    def get(self, eid: str) -> dict:
        if not valid_id(eid):
            raise KeyError("No evidence line with that id.")
        for ln in self.lines()[0]:
            if ln["id"] == eid:
                return ln
        raise KeyError("No evidence line with that id.")

    # ---- write
    def _append(self, records: list[dict]) -> None:
        """Append whole lines: the old bytes are kept exactly (a corrupt line stays as it was) and the new file
        replaces the old in one os.replace."""
        if not records:
            return
        self.root.mkdir(parents=True, exist_ok=True)
        try:
            old = self.path.read_bytes()
        except FileNotFoundError:
            old = b""
        if old and not old.endswith(b"\n"):
            old += b"\n"
        new = "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in records).encode("utf-8")
        tmp = self.path.with_name(self.path.name + ".tmp")
        with open(tmp, "wb") as f:
            f.write(old + new)
            f.flush()
            os.fsync(f.fileno())
        # A reader outside this process (a backup, an antivirus scan, his data repository's git) can hold the file
        # for a moment, and Windows then refuses the replace; five tries 0.1 s apart let a hold under half a second pass.
        for attempt in range(5):
            try:
                os.replace(tmp, self.path)
                return
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.1)

    def add(self, raw: Any, today: str) -> dict:
        """K-02: one typed line. Every refusal is a ValueError with a sentence the screen can print."""
        if not isinstance(raw, dict):
            raise ValueError("Send the line as {kind, title, link or file}.")
        kind = raw.get("kind")
        if kind not in KINDS:
            raise ValueError(f"kind must be one of {', '.join(KINDS)}.")
        title = raw.get("title")
        if not isinstance(title, str) or not _plain(title):
            raise ValueError("Give the line a title.")
        title = _plain(title)
        if len(title) > MAX_TITLE:
            raise ValueError(f"A title is at most {MAX_TITLE} characters; this one is {len(title)}.")
        link = check_link(raw.get("link"))
        file = check_file(raw.get("file"), self.files, self.root)
        if link is None and file is None:
            raise ValueError("A line needs a link or a file: without one it is a claim, not evidence.")
        at = _day(raw["at"], "at") if raw.get("at") not in (None, "") else today
        if at > today:
            raise ValueError("The date is in the future; give the day it happened.")
        rec = {"v": SCHEMA_VERSION, "op": "add", "id": "e-" + os.urandom(8).hex(), "at": at, "kind": kind,
               "title": title, "link": link, "file": file, "node_ids": _node_ids(raw.get("node_ids")),
               "source": "typed", "made": round(time.time(), 3)}
        with self._lock:
            # The same proof typed twice (a double press, a retry) would count twice in totals; the first line is
            # answered instead. A removed line does not match, so he can file again what he removed.
            for ln in self.lines()[0]:
                if (ln.get("source") == "typed" and not ln["removed"] and ln["kind"] == kind and ln["title"] == title
                        and ln.get("link") == link and ln.get("file") == file):
                    return ln
            self._append([rec])
        return {**rec, "removed": False, "removed_on": None}

    def remove(self, eid: str, today: str) -> tuple[dict, bool]:
        """K-03: (the line as it now stands, whether this call removed it). A second removal changes nothing."""
        with self._lock:
            ln = self.get(eid)
            if ln["removed"]:
                return ln, False
            self._append([{"v": SCHEMA_VERSION, "op": "remove", "id": eid, "at": today, "made": round(time.time(), 3)}])
        return {**ln, "removed": True, "removed_on": today}, True

    def add_many(self, records: list[dict]) -> tuple[list[dict], int]:
        """K-04: the records whose id is not on file yet (a removed one counts as on file, so an import never
        brings back a line he removed), in one write. Answers (added, already)."""
        with self._lock:
            have = {ln["id"] for ln in self.lines()[0]}
            fresh, seen = [], set()
            for r in records:
                if r["id"] in have or r["id"] in seen:
                    continue
                seen.add(r["id"])
                fresh.append(r)
            self._append(fresh)
        return fresh, len(records) - len(fresh)


# ------------------------------------------------------------------ K-01 view
def view(ln: dict, root: Path) -> dict:
    link = ln.get("link") if isinstance(ln.get("link"), str) else None
    hard_link = link is not None and _site_link(link)       # the same test as K-02, so a hand-edited line is no harder
    out = {"id": ln["id"], "at": ln["at"], "kind": ln["kind"], "node_ids": list(ln.get("node_ids") or []),
           "title": ln["title"], "link": link, "file": ln.get("file") if isinstance(ln.get("file"), str) else None,
           "source": ln.get("source") if ln.get("source") in SOURCES else "typed",
           "hard": hard_link or file_exists(ln.get("file"), root), "removed": bool(ln.get("removed")),
           "removed_on": ln.get("removed_on")}
    if ln.get("repo"):
        out["repo"], out["sha"] = ln["repo"], ln.get("sha")
    return out


def select(views: list[dict], node: Optional[str] = None, kind: Optional[str] = None,
           frm: Optional[str] = None, to: Optional[str] = None) -> list[dict]:
    if kind is not None and kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}.")
    if frm and to and frm > to:
        raise ValueError("from is after to.")
    out = [v for v in views
           if (node is None or node in v["node_ids"]) and (kind is None or v["kind"] == kind)
           and (frm is None or v["at"] >= frm) and (to is None or v["at"] <= to)]
    return out


def totals(views: list[dict]) -> dict:
    """Lines and hard lines per kind; a removed line is in no count."""
    t = {k: {"lines": 0, "hard": 0} for k in KINDS}
    for v in views:
        if v["removed"]:
            continue
        t[v["kind"]]["lines"] += 1
        t[v["kind"]]["hard"] += 1 if v["hard"] else 0
    return t


def newest_first(views: list[dict], order: dict[str, int]) -> list[dict]:
    """By date, then by when the line was filed (file order), newest first."""
    return sorted(views, key=lambda v: (v["at"], order.get(v["id"], 0)), reverse=True)


# ------------------------------------------------------------------ K-04 commits
def repo_problem(path_text: str) -> Optional[str]:
    """Why a repository path from his inputs cannot be read, or None. Checked before git is started."""
    if _is_network_or_device(path_text):
        return "This is a network or device path; only folders on this PC are read."
    p = Path(path_text)
    if not p.is_absolute():
        return "This path is not a full path (like D:\\code\\project)."
    try:
        if not p.is_dir():
            return "There is no folder at this path."
        dot = p / ".git"
        if not dot.exists():
            return "This folder is not a git repository."
        # Plain file reads before git starts: each of these makes git open a path the repository chooses, which
        # can be a network share (an SMB connection offering his login), and no -c switch turns them off.
        if dot.is_file():
            return ("Its .git is a file pointing to a git folder elsewhere (a linked worktree); list the main "
                    "checkout instead.")
        cfg = dot / "config"
        if cfg.is_file():
            if cfg.stat().st_size > MAX_GIT_CONFIG:
                return "Its .git/config is over 256 KB, so it was not read."
            if _INCLUDE.search(cfg.read_text(encoding="utf-8", errors="replace")):
                return ("Its .git/config has an [include] or [includeIf] section, which makes git read other "
                        "files; it was not read.")
        alt = dot / "objects" / "info" / "alternates"
        if alt.is_file() and alt.stat().st_size > 0:
            return "It borrows objects from another place (.git/objects/info/alternates); it was not read."
    except OSError:
        return "This folder could not be read."
    return None


def _git_runner(fails: list[str]) -> Callable[[list[str], str], str]:
    """The only way this package starts a process: `git log` or `git rev-parse`, nothing else, with a timeout.
    GIT_OPTIONAL_LOCKS=0 stops git from refreshing the index on a read; no pager, no prompt, never a remote."""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    # No GIT_* variable of the app's own environment reaches git: GIT_DIR or GIT_WORK_TREE would point every
    # import at one other repository, and GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT would add config to it.
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith("GIT_")}
    env.update({"GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0", "GIT_PAGER": "cat", "PAGER": "cat"})

    def run(args: list[str], cwd: str) -> str:
        if len(args) < 2 or args[0] != "git" or args[1] not in ("log", "rev-parse"):
            raise PermissionError("only git log and git rev-parse are run here")
        # log.showSignature=false: a repository's own config can set it with gpg.program, and `git log` then
        # starts that program for every signed commit (shown in a test of 2026-11-27 with a batch file). A -c
        # on the command line outranks the repository's config.
        # The mailmap is read at the start of every log; mailmap.file or mailmap.blob from the repository's config
        # could name a network path (an SMB connection offering his login). Emptied here, it is never read: a test
        # maps an author through mailmap.file, and the runner's %aN comes back unmapped.
        full = ["git", "--no-pager", "-c", "core.fsmonitor=false", "-c", "log.showSignature=false",
                "-c", "log.mailmap=false", "-c", "mailmap.file=", "-c", "mailmap.blob=", *args[1:]]
        try:
            r = subprocess.run(full, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                               timeout=GIT_TIMEOUT_S, check=False, creationflags=flags, env=env, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            fails.append(f"git took longer than {GIT_TIMEOUT_S} s")
            raise
        except OSError:
            fails.append("git could not be started")
            raise
        if r.returncode != 0:
            if "--verify" not in args:        # `rev-parse --verify HEAD` exits 1 in a repository with no commit yet
                fails.append("git could not read this repository")
            return ""
        return r.stdout
    return run


def import_commits(ledger: Ledger, repos: list[dict], names: Any, today: str,
                   run_factory: Callable[[list[str]], Callable[[list[str], str], str]] = _git_runner) -> dict:
    """K-04. `repos` are his inputs' work_repos ({path, name, url}); `names` only chooses among them."""
    if names is not None:
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            raise ValueError("repos must be a list of repository names from your inputs.")
        if len(names) > MAX_REPOS:
            raise ValueError(f"At most {MAX_REPOS} repositories.")
        by = {r["name"]: r for r in repos}
        for n in names:
            if n not in by:
                raise KeyError("No repository by that name in your inputs.")
        chosen = [by[n] for n in dict.fromkeys(names)]
    else:
        chosen = list(repos)[:MAX_REPOS]
    if not ledger._import.acquire(blocking=False):
        raise Busy("A commit import is already running.")
    try:
        per, records = [], []
        for r in chosen:
            name, url = str(r.get("name") or ""), r.get("url")
            why = repo_problem(str(r.get("path") or ""))
            if why:
                per.append({"name": name, "commits": 0, "reason": why})
                continue
            fails: list[str] = []
            run = run_factory(fails)
            try:
                head = (run(["git", "rev-parse", "--git-dir"], str(r["path"])).strip()
                        and run(["git", "rev-parse", "--verify", "--quiet", "HEAD"], str(r["path"])).strip())
            except Exception:
                head = ""
            if not head:
                per.append({"name": name, "commits": 0, "reason": fails[0] + "." if fails else "This repository has no commits yet."})
                continue
            got = github_activity.local_commits([{"path": r["path"], "name": name, "url": url}], since_days=IMPORT_DAYS, run=run)
            if fails:
                per.append({"name": name, "commits": 0, "reason": fails[0] + "."})
                continue
            got = [c for c in got if _SHA.match(str(c.get("sha") or ""))]
            got.sort(key=lambda c: c["ts"], reverse=True)
            left = max(0, len(got) - IMPORT_CAP)
            got = got[:IMPORT_CAP]
            # A link is written only for a commit a remote-tracking branch holds: a commit that never left the
            # laptop would get an https address that answers 404, a line claiming proof it does not have. The
            # remote-tracking refs are as fresh as his last fetch; nothing here contacts the remote.
            pushed: set[str] = set()
            if url and got:
                try:
                    pushed = set(run(["git", "log", "--remotes", f"--since={IMPORT_DAYS} days ago", "--format=%H"],
                                     str(r["path"])).split())
                except Exception:
                    pushed = set()
            kept = linked = 0
            for c in got:
                try:
                    day = date.fromtimestamp(c["ts"]).isoformat()
                except (OverflowError, OSError, ValueError):
                    # An author date past what the clock library reads (year 5138 raised OSError 22 on Windows)
                    # is that one commit's fault; it is left out so the other repositories still import.
                    continue
                kept += 1
                link = c.get("url") if isinstance(c.get("url"), str) and c["sha"] in pushed else None
                linked += 1 if link else 0
                records.append({"v": SCHEMA_VERSION, "op": "add", "id": commit_id(name, c["sha"]), "at": min(day, today),
                                "kind": "commit", "title": (_plain(str(c.get("subject") or "")) or "(no subject)")[:MAX_TITLE],
                                "link": link, "file": None, "node_ids": [],
                                "source": "git", "repo": name, "sha": c["sha"], "made": round(time.time(), 3)})
            reason = f"{kept} commits read from the checked-out branch."
            if kept < len(got):
                reason += f" {len(got) - kept} had an author date that could not be read and were left out."
            if left:
                reason += f" {left} older ones were left: an import keeps the newest {IMPORT_CAP}."
            if got and not url:
                reason += " No https link is set for this repository in your inputs, so its lines are soft."
            elif linked < kept:
                reason += (f" {kept - linked} are on no remote-tracking branch, so they carry no link and are soft"
                           " until they are pushed and fetched.")
            per.append({"name": name, "commits": kept, "reason": reason})
        added, already = ledger.add_many(records)
        return {"added": len(added), "already": already, "repos": per}
    finally:
        ledger._import.release()


# ------------------------------------------------------------------ xp_check
XP_KINDS = ("cert", "ship", "project")       # the plan's events that grant XP for a certificate, a project or a ship


def xp_check(plan_state: Optional[dict], inputs: dict, today: str) -> dict:
    """The plan's XP for certificates, projects and ships beside what ww_engines.evidence grants the same records.
    Both rules are read as they are; neither is changed here (the owner decides which one stands)."""
    if not isinstance(plan_state, dict):
        return {"plan_xp": None, "evidenced_xp": None, "records_without_proof": None,
                "reason": "The plan store is not up yet, so there are no records to count."}
    evs = [e for e in plan_state.get("events") or [] if isinstance(e, dict) and e.get("kind") in XP_KINDS]
    plan_xp = 0
    for e in evs:
        try:
            plan_xp += int(e.get("xp") or 0)
        except (TypeError, ValueError):
            pass
    actions = [a for a in ww_engines.actions_from_plan({"events": evs}) if a.get("kind") in ("cert", "project")]
    evidenced = ww_engines.evidence(inputs, today, actions)["xp"]
    without = sum(1 for e in evs if e.get("verified") is not True)
    reason = (f"{len(evs)} certificate, project and ship records: the plan granted {plan_xp} XP, the evidence rule "
              f"grants {evidenced}; {without} of them carry no link.")
    # A malformed archive (a count that is text, a list for the map) used to raise out of K-01 and take the whole
    # ledger answer down with it; it now only drops this note.
    try:
        trimmed = sum(int(((plan_state.get("archive") or {}).get("count") or {}).get(k) or 0) for k in XP_KINDS)
    except (AttributeError, TypeError, ValueError):
        trimmed = 0
    if trimmed:
        reason += f" {trimmed} older records were folded into the archive and are not in either number."
    return {"plan_xp": plan_xp, "evidenced_xp": evidenced, "records_without_proof": without, "records": len(evs),
            "reason": reason}
