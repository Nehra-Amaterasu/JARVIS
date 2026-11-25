"""Classroom to the disk: every attached Drive file as an original, and its text as a Markdown note.

    store = GcrStore()                       # under <data>/gcr
    sync(api, store, subjects=[...])         -> summary dict; safe to run again (a file that did not change is not fetched)
    store.manifest()                         -> {"courses": {...}, "files": {...}, "synced_at", "faults"}; ManifestError if damaged
    store.update(fn)                         -> read-modify-write of the manifest under the store's one process-wide lock
    store.original(fid) / store.note(fid)    -> Path

Layout, all private (data/ never enters the public repository):
    gcr/manifest.json                         what came from which course and post, and the state of each file
    gcr/originals/<course-slug>/<file id>.<ext>
    gcr/notes/<course-slug>/<file id>.md

Rules kept here:
  * Read only towards Google. A Google Doc, Slides or Sheet has no bytes of its own, so it is exported as PDF: one format
    the in-app reader shows and the extractor reads.
  * A note is the file's own text, moved into Markdown with page or slide headings. Nothing is summarised or added here.
    A page that is only a picture has no text: the note says how many pages are scans and its state is WAITING, never a
    made-up body. Old binary formats (.ppt, .doc) and pictures are kept as originals with the reason no note exists.
  * Everything from Google is untrusted: ids are checked before they become paths or URLs, a name gives an extension only
    from a closed list, every download carries the Mark of the Web, and a title cannot break a note's front matter.
  * A file is a "paper" when its title, its post or its topic names a test or a question paper (PAPER_RULE). That is a
    rule, it can be wrong, and the record says kind_source "rule" until he changes it by hand.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import httpx

from .. import paths
from . import classroom
from .api import DRIVE, META_FIELDS, REPLACE_TRIES, REPLACE_WAIT, ApiError, GoogleApi, as_reason, replace_with_retry
from .auth import NotConnected

GOOGLE_APPS = "application/vnd.google-apps."
FOLDER = GOOGLE_APPS + "folder"
SHORTCUT = GOOGLE_APPS + "shortcut"
FORM = GOOGLE_APPS + "form"
EXPORT_PDF = {"application/vnd.google-apps.document", "application/vnd.google-apps.presentation",
              "application/vnd.google-apps.spreadsheet", "application/vnd.google-apps.drawing"}
EXT_BY_MIME = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-powerpoint": "ppt", "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt", "text/markdown": "md", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
}
# What a file's own name may give as its extension when Google's type says nothing: documents, pictures, archives. Anything
# else is "bin", so no name typed by a stranger decides what Windows does with the saved file.
KNOWN_EXT = frozenset({"pdf", "pptx", "ppt", "docx", "doc", "xlsx", "xls", "odt", "odp", "ods", "rtf", "txt", "md", "csv",
                       "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "zip", "rar", "7z"})
READABLE = {"pdf", "pptx", "docx", "txt", "md"}            # what yaadash.library.extract reads
WORD_NOTES = {"doc"}                                       # read through the local Word, then as a PDF (_make_note)
NO_NOTE = {"ppt": "An old PowerPoint file: open the original.", "doc": "An old Word file: open the original.",
           "jpg": "A picture: its text needs OCR.", "png": "A picture: its text needs OCR.", "webp": "A picture: its text needs OCR.",
           "xlsx": "A spreadsheet: open the original."}
FOLDER_CAP = 200                                           # files taken from one attached folder (two levels deep)
PAPER_RULE = re.compile(
    r"(?<![a-z])(c\.?i\.?e|internal(?:s| test| exam| assessment)?|sessional|mid[\s-]?sem(?:ester)?|mst|class test|unit test|"
    r"question paper|q\.?\s?p|pyq|previous year|end[\s-]?sem(?:ester)?|sample paper|model paper|test paper|quiz paper)(?![a-z])", re.I)
# Met on the real Classroom (22 Nov 2026): posts named "CIE-2 marks", "CIE2 Mark List", "Eligible student list for CIE3" and
# "CIE-III Syllabus" all name a test and none is a paper. A name of this kind is "other", whatever else it says.
NOT_STUDY_RULE = re.compile(r"(?<![a-z])(marks?|mark\s?list|marksheet|eligib\w*|attendance|defaulters?|result|time\s?table|"
                            r"schedule|date\s?sheet|seating|notice|circular)(?![a-z])", re.I)
# Question banks, model papers and lists of questions are question sources like a test paper.
QUESTIONS_RULE = re.compile(r"(?<![a-z])(question\s?bank|q\.?\s?b|model\s?q\.?\s?p|important questions?|practice questions?|"
                            r"previous (?:year )?questions?)(?![a-z])", re.I)
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{6,120}$")           # a Drive id: 28 to 44 characters of this alphabet in practice
# A Classroom course id is digits (12 to 13 on the real one, 4 in the test fixture): the danger is the characters, not the length.
_SAFE_COURSE = re.compile(r"^[A-Za-z0-9_-]{1,120}$")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slug(name: str, fallback: str = "course") -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-")[:48]
    return s or fallback


def is_paper(*names: str) -> bool:
    return classify(*names) == "paper"


def classify(name: str, *context: str) -> str:
    """\"paper\", \"notes\" or \"other\" by rule. The file's own name decides first: a mark list attached to a post called
    \"CIE\" is not a paper, and a paper attached to it is. The post and topic only help a file whose own name says nothing."""
    name = re.sub(r"[_\-.]+", " ", name or "")
    context = tuple(re.sub(r"[_\-.]+", " ", c or "") for c in context)
    if NOT_STUDY_RULE.search(name):
        return "other"
    if PAPER_RULE.search(name) or QUESTIONS_RULE.search(name):
        return "paper"
    if re.search(r"(?<![a-z])(notes?|unit|lecture|chapter|module|ppt|slides?|sol(?:ution)?s?|assignment|tutorial)(?![a-z])", name, re.I):
        return "notes"
    if any(NOT_STUDY_RULE.search(c) for c in context):
        return "other"
    return "paper" if any(PAPER_RULE.search(c) or QUESTIONS_RULE.search(c) for c in context) else "notes"


def _atomic_write(path: Path, text: str) -> None:
    """Whole or not at all, and never two writers on one temporary name: the old fixed "manifest.json.tmp" let a route's
    save and the sync thread's save write into the same file and replace each other's half. The temporary file sits in the
    same folder (os.replace is atomic only within one volume) and is flushed to the disk before it takes the name."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        replace_with_retry(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _write_json(path: Path, data: Any) -> None:
    _atomic_write(path, json.dumps(data, ensure_ascii=False, indent=1))


class ManifestError(RuntimeError):
    """The manifest on disk could not be read. The sentence says where the damaged copy was put; nothing was overwritten."""


# One lock per store folder for the whole process. The routes build a GcrStore per request, so a lock held by the instance
# protected nothing: the sync thread and a PATCH each had their own. Re-entrant, because update() reads and saves under it.
_REGISTRY_LOCK = threading.Lock()
_LOCKS: dict[str, threading.RLock] = {}
_BAD: dict[str, str] = {}                    # store key -> the sentence of a manifest set aside, until the next good save


def _key(root: Path) -> str:
    return os.path.normcase(str(Path(root).resolve()))


def _store_lock(root: Path) -> threading.RLock:
    with _REGISTRY_LOCK:
        return _LOCKS.setdefault(_key(root), threading.RLock())


def _blank() -> dict:
    return {"version": 1, "synced_at": "", "courses": {}, "files": {}, "faults": []}


def _read_retry(p: Path) -> str:
    for n in range(REPLACE_TRIES):
        try:
            return p.read_text(encoding="utf-8")
        except PermissionError:                  # a writer's os.replace in flight on Windows: milliseconds
            if n == REPLACE_TRIES - 1:
                raise
            time.sleep(REPLACE_WAIT)
    raise AssertionError("unreachable")


class GcrStore:
    def __init__(self, root: Optional[Path] = None):
        self.root = Path(root) if root else paths.DATA / "gcr"
        self._k = _key(self.root)
        self._lock = _store_lock(self.root)

    def _set_aside(self, p: Path) -> str:
        """Move a damaged manifest out of the way so the next save cannot overwrite the only copy of his hand edits."""
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        dst = p.with_name(f"manifest.json.bad-{stamp}")
        n = 1
        while dst.exists():
            n += 1
            dst = p.with_name(f"manifest.json.bad-{stamp}-{n}")
        try:
            replace_with_retry(p, dst)
            why = (f"The list of fetched files was damaged. It was set aside as {dst.name} and nothing was overwritten: "
                   "sync to rebuild it (kinds and subjects set by hand are in the set-aside copy).")
        except OSError:
            why = "The list of fetched files cannot be read and was left as it is. Nothing was overwritten."
        _BAD[self._k] = why
        return why

    def manifest(self, fresh_ok: bool = False) -> dict:
        """The manifest, or a blank one when there is none yet. A damaged one raises ManifestError (never a silent blank that
        the next save would write over the real one). After a damaged one was set aside, reads keep raising until a save;
        `fresh_ok` is the writers' door (update, the sync), which may start from blank to rebuild."""
        p = self.root / "manifest.json"
        with self._lock:
            try:
                raw = _read_retry(p)
            except FileNotFoundError:
                if self._k in _BAD and not fresh_ok:
                    raise ManifestError(_BAD[self._k]) from None
                return _blank()
            except OSError:
                raise ManifestError(self._set_aside(p)) from None
            try:
                d = json.loads(raw)
                if not isinstance(d, dict) or not isinstance(d.get("courses", {}), dict) or not isinstance(d.get("files", {}), dict):
                    raise ValueError("not a manifest")
            except ValueError:
                raise ManifestError(self._set_aside(p)) from None
            d.setdefault("courses", {})
            d.setdefault("files", {})
            return d

    def save(self, m: dict) -> None:
        with self._lock:
            _write_json(self.root / "manifest.json", m)
            _BAD.pop(self._k, None)

    def update(self, fn: Callable[[dict], Any], fresh_ok: bool = False) -> Any:
        """Read-modify-write under the store's one lock: load fresh, let `fn` change it, save. Every writer goes through here,
        so a hand edit and the sync thread each change only their own lines of the newest copy. Only the sync passes
        `fresh_ok`: after a damaged manifest was set aside it rebuilds from blank, while a hand edit is refused (a blank
        manifest holding one edit would hide that everything else was lost)."""
        with self._lock:
            m = self.manifest(fresh_ok=fresh_ok)
            out = fn(m)
            self.save(m)
            return out

    def _rel(self, fid: str, key: str) -> Path:
        if not _SAFE_ID.match(fid or ""):
            raise KeyError(fid)
        rec = self.manifest()["files"].get(fid)
        rel = (rec or {}).get(key)
        if not rel:
            raise KeyError(fid)
        p = (self.root / rel).resolve()
        if self.root.resolve() not in p.parents or not p.is_file():       # a manifest line never reaches outside the store
            raise KeyError(fid)
        return p

    def original(self, fid: str) -> Path:
        return self._rel(fid, "path")

    def note(self, fid: str) -> Path:
        return self._rel(fid, "note")


def _one_line(text: Any) -> str:
    """Titles come from Google and are typed by teachers: a newline in one would end the front matter or start a heading."""
    return " ".join(str(text or "").split())


def to_markdown(ex, rec: dict) -> tuple[str, int]:
    """The extractor's sections as one Markdown note with a small header; returns (text, word count)."""
    title = _one_line(rec.get("title", "")) or _one_line(ex.title)
    head = ["---", f"title: {json.dumps(_one_line(rec.get('title', '')), ensure_ascii=False)}",
            f"course: {json.dumps(_one_line(rec.get('course_name', '')), ensure_ascii=False)}",
            f"post: {json.dumps(_one_line((rec.get('post') or {}).get('title', '')), ensure_ascii=False)}",
            "source: Google Classroom", f"original: {_one_line(rec.get('path', ''))}", f"pages: {ex.pages}",
            f"fetched: {_one_line(rec.get('fetched_at', ''))}", "---", "", f"# {title}", ""]
    body: list[str] = []
    words = 0
    last = None
    for s in ex.sections:
        text = (s.text or "").strip()
        if not text:
            continue
        where = _one_line(s.loc) or (f"p. {s.page}" if s.page else "")
        title = " · ".join(x for x in (where, _one_line(s.heading)) if x)
        if title and title != last:
            body += [f"## {title}", ""]
            last = title
        body += [text, ""]
        words += len(text.split())
    if ex.scanned:
        body += [f"> {len(ex.scanned)} of {ex.pages} pages are pictures with no text layer (pages "
                 f"{', '.join(str(n) for n in ex.scanned[:12])}{'…' if len(ex.scanned) > 12 else ''}). Open the original for them.", ""]
    return "\n".join(head + body), words


def _word_pdf(path: Path) -> Path:
    """An old .doc printed to PDF by the Word on this PC (ww_pyq/word.py), in a temporary file the caller removes."""
    import tempfile
    from ..ww_pyq import word
    pdf = word.to_pdf(path.read_bytes(), ".doc")
    fd, name = tempfile.mkstemp(prefix="ww-doc-note-", suffix=".pdf")
    with os.fdopen(fd, "wb") as f:
        f.write(pdf)
    return Path(name)


def _make_note(store: GcrStore, rec: dict, extract: Callable, word_pdf: Callable = _word_pdf) -> None:
    ext = rec["ext"]
    if ext in WORD_NOTES:
        # Nothing in Python here reads the old Word format, and 28 of his notes and 1 paper are .doc files. Word prints
        # the file and the PDF is read. One try per version of the file: a file Word cannot print is not started again
        # on every sync (a start costs 1 to 30 s).
        rec["note_tried"] = rec.get("modified", "") or "once"
        tmp = None
        try:
            tmp = word_pdf(store.root / rec["path"])
            ex = extract(tmp)
        except ValueError as e:
            rec.update(note="", note_state="waiting", note_reason=str(e))
            return
        except Exception as e:
            rec.update(note="", note_state="fault", note_reason=f"The file could not be read ({type(e).__name__}).")
            return
        finally:
            if tmp is not None:
                tmp.unlink(missing_ok=True)
        _write_note(store, rec, ex)
        return
    if ext not in READABLE:
        rec.update(note="", note_state="waiting", note_reason=NO_NOTE.get(ext, "This kind of file has no text to read: open the original."))
        return
    try:
        ex = extract(store.root / rec["path"])
    except Exception as e:                                   # a broken file keeps its original and says so
        rec.update(note="", note_state="fault", note_reason=f"The file could not be read ({type(e).__name__}).")
        return
    _write_note(store, rec, ex)


def _write_note(store: GcrStore, rec: dict, ex) -> None:
    text, words = to_markdown(ex, rec)
    rel = f"notes/{rec['course_slug']}/{rec['id']}.md"
    try:
        _atomic_write(store.root / rel, text)                # the reader may hold the old note open: replace waits for it
    except OSError:
        rec.update(note_state="fault", note_reason="The note could not be written: the disk refused it.")
        return
    scanned = len(ex.scanned)
    rec.update(note=rel, pages=ex.pages, words=words, scanned_pages=scanned)
    if words == 0:
        rec.update(note_state="waiting", note_reason=("Every page is a picture: the text needs OCR." if scanned else "The file has no text."))
    elif scanned:
        rec.update(note_state="live", note_reason=f"{scanned} of {ex.pages} pages are pictures and are not in the note.")
    else:
        rec.update(note_state="live", note_reason=f"{words} words from {ex.pages or 1} {'pages' if (ex.pages or 1) != 1 else 'page'}.")


def _resolve(api: GoogleApi, meta: dict, notes: list[str]) -> Optional[dict]:
    """A Drive shortcut is a pointer with no bytes: follow it one hop to its target. A shortcut to a shortcut is not
    followed (one hop is what Drive's own UI does, and a loop of them would never end)."""
    if meta.get("mimeType") != SHORTCUT:
        return meta
    name = _one_line(meta.get("name", "")) or "a shortcut"
    target = str((meta.get("shortcutDetails") or {}).get("targetId") or "")
    if not _SAFE_ID.match(target):
        notes.append(f"The shortcut {name} points to an id that is not a Drive id; skipped.")
        return None
    t = api.file_meta(target)
    if t.get("mimeType") == SHORTCUT:
        notes.append(f"The shortcut {name} points to another shortcut; only one hop is followed.")
        return None
    return t


def _expand(api: GoogleApi, fid: str, title: str, depth: int = 0, notes: Optional[list[str]] = None) -> list[dict]:
    """Drive metadata of one attachment; a folder gives the files inside it (two levels, capped). What the cap or the depth
    left out is said in `notes`, with the numbers known."""
    notes = notes if notes is not None else []
    if not _SAFE_ID.match(str(fid or "")):                  # it would become part of a URL
        notes.append(f"{_one_line(title) or 'An attachment'} has an id that is not a Drive id; skipped.")
        return []
    meta = _resolve(api, api.file_meta(fid), notes)
    if meta is None:
        return []
    if meta.get("mimeType") != FOLDER:
        return [meta]
    out: list[dict] = []
    state = {"cut": False}
    _list_folder(api, meta, depth, out, notes, state)
    if state["cut"]:
        notes.append(f"The folder {_one_line(meta.get('name', '')) or title} holds more than {FOLDER_CAP} files: "
                     f"the first {FOLDER_CAP} by name were taken.")
    return out


def _list_folder(api: GoogleApi, folder: dict, depth: int, out: list[dict], notes: list[str], state: dict) -> None:
    fid = str(folder.get("id", ""))
    if not _SAFE_ID.match(fid):
        notes.append("A folder with an id that is not a Drive id was skipped.")
        return
    # orderBy name: the cap then keeps the same 200 files on every run (Drive's default order is not stable), and "Unit 1"
    # comes before "Unit 9" for the reader.
    q = {"q": f"'{fid}' in parents and trashed = false", "pageSize": 200, "supportsAllDrives": "true", "orderBy": "name",
         "includeItemsFromAllDrives": "true", "fields": f"nextPageToken,files({META_FIELDS})"}
    deeper = 0
    for child in api.pages(f"{DRIVE}/files", "files", q, limit=FOLDER_CAP + 1):
        if len(out) >= FOLDER_CAP:
            state["cut"] = True
            return
        child = _resolve(api, child, notes)
        if child is None:
            continue
        if child.get("mimeType") == FOLDER:
            if depth + 1 >= 2:
                deeper += 1
            else:
                _list_folder(api, child, depth + 1, out, notes, state)
                if state["cut"]:
                    return
        else:
            out.append(child)
    if deeper:
        notes.append(f"In the folder {_one_line(folder.get('name', '')) or fid}, {deeper} "
                     f"{'folder' if deeper == 1 else 'folders'} nested more than two levels deep were not read.")


# Words that say nothing about which subject a course is: they sit in most course names and many subject names.
_FILLER = {"and", "of", "the", "its", "it", "s", "in", "for", "to", "a", "an", "theory", "application", "applications", "open",
           "elective", "sem", "semester", "section", "sec", "batch", "year", "course", "class", "lab", "btech", "tech"}


def _stems(text: str) -> set[str]:
    """Lower-case words with a plural s dropped ("circuits" and "circuit", "microelectronics" and "microelectronic")."""
    out = set()
    for w in re.findall(r"[a-z]+|[0-9]+[a-z]*[0-9]*", str(text or "").lower()):
        if w in _FILLER or len(w) < 2:
            continue
        out.add(w[:-1] if len(w) > 4 and w.endswith("s") and not w.endswith("ss") else w)
    return out


def match_subject(course_name: str, subjects: list[dict]) -> tuple[str, float]:
    """The plan subject a Classroom course belongs to, by rule, with its score; ("", score) when no rule is sure.

    The first rule (the share of words two names have in common) mapped 4 of the first 9 real courses on 22 Nov 2026:
    teachers name a course by its code alone, by the subject with a plural the plan does not use, or with the class and
    semester added. So, in order: the subject's code inside the course name; the course name being the subject's initials
    or id; every telling word of the subject's name found in the course name. Two subjects that fit equally well map to
    neither: he picks by hand."""
    from ..ww_intake.match import match_name
    squeezed = re.sub(r"[^a-z0-9]", "", str(course_name or "").lower())
    words = _stems(course_name)
    scored: list[tuple[float, str]] = []
    for s in subjects or []:
        sid, name = str(s.get("id", "")), str(s.get("name", ""))
        code = re.sub(r"[^a-z0-9]", "", str(s.get("code") or "").lower())
        v = max(match_name(course_name, name), match_name(course_name, sid.replace("-", " ")))
        if len(code) >= 5 and code in squeezed:
            v = 1.0
        initials = "".join(w[0] for w in re.findall(r"[a-z]+", name.lower()))
        if squeezed and squeezed in (initials, sid.replace("-", ""), "".join(w[0] for w in re.findall(r"[a-z]+", name.lower()) if w not in _FILLER)):
            v = max(v, 0.95)
        want = _stems(name)
        if want and want <= words and (len(want) >= 2 or len(next(iter(want))) >= 8):
            v = max(v, 0.9)
        if v > 0:
            scored.append((v, sid))
    if not scored:
        return "", 0.0
    scored.sort(reverse=True)
    top = scored[0]
    if top[0] < 0.5 or (len(scored) > 1 and scored[1][0] == top[0]):
        return "", top[0]
    return top[1], top[0]


def sync(api: GoogleApi, store: Optional[GcrStore] = None, *, subjects: Optional[list[dict]] = None,
         only: Optional[list[str]] = None, extract: Optional[Callable] = None,
         on_event: Optional[Callable[[dict], Any]] = None, stop: Optional[threading.Event] = None,
         account: str = "main", seen: Optional[set] = None) -> dict:
    """Read every course (or `only` those ids), fetch what changed, write notes. Returns the counts of this run.

    Every write is a small update of the newest manifest (one file record as soon as it is fetched, one course record when
    the course is read, the run's faults at the end), never a whole copy loaded at the start: a kind or subject set by hand
    and a paper_id written while this runs survive it. `seen` is the file ids already handled in this run across accounts:
    one Drive file attached in two places is fetched once and counted once.

    The result carries "stopped" (the stop event ended it; synced_at is left as it was) and "error" (the sign-in died part
    way; what was fetched before is kept). Only a refusal before any course was read raises."""
    store = store or GcrStore()
    if extract is None:
        from library import extract as _extract     # yaadash/ is on the path (jarvis.pth), as routes_library.py imports it
        extract = _extract
    say = on_event or (lambda e: None)
    halted = (lambda: stop is not None and stop.is_set())
    handled = seen if seen is not None else set()
    t0 = time.time()
    counts = {"courses": 0, "posts": 0, "files": 0, "fetched": 0, "unchanged": 0, "notes": 0, "papers": 0, "faults": 0, "bytes": 0}
    faults: list[str] = []
    error = ""
    courses = classroom.courses(api)                         # NotConnected and ApiError here end the run: nothing was read
    try:
        for c in courses:
            if halted():
                break
            if only is not None and c["id"] not in only:
                continue
            if not _SAFE_COURSE.match(c["id"]):
                # the id becomes a folder name and a URL segment: a value with a slash or dots is not used anywhere
                faults.append(f"{_one_line(c['name']) or 'A course'}: Google gave it an id that is not safe as a folder name, so it was skipped.")
                counts["faults"] += 1
                continue
            old = store.manifest(fresh_ok=True)["courses"].get(c["id"], {})
            if old.get("include") is False:
                continue
            try:
                _one_course(api, store, c, old, subjects or [], extract, counts, faults, say, halted, handled, account)
            except NotConnected:
                raise
            except Exception as e:                       # one course's bug or bad answer must not end the other courses
                faults.append(f"{c['name']}: the course stopped part way ({_plain(e)}).")
                counts["faults"] += 1
        if only is None and not halted():
            # his own calendar for the next 60 days, once per account and only on a full run
            try:
                cal = {"read_at": _now(), "events": classroom.calendar_events(api)[:500], "fault": ""}
            except NotConnected:
                raise
            except (ApiError, httpx.HTTPError) as e:
                cal = {"read_at": _now(), "events": [], "fault": "permission" if getattr(e, "status", 0) == 403 else as_reason(e)}
            store.update(lambda m: m.setdefault("calendar", {}).__setitem__(account, cal), fresh_ok=True)
    except NotConnected as e:                            # the sign-in died part way: keep what was fetched, say so
        error = str(e)
        faults.append(error)
        counts["faults"] += 1
    stopped = halted()

    def finish(m: dict) -> None:
        if not stopped and not error:
            m["synced_at"] = _now()                      # a stopped or broken run is not a sync of everything
        by = dict(m.get("faults_by") or {})             # one list per account: a run of one account keeps the other's lines
        if not stopped:
            by[account] = faults[:100]
        m["faults_by"] = by
        m["faults"] = [x for name in sorted(by) for x in by[name]][:200]
    store.update(finish, fresh_ok=True)
    counts["seconds"] = round(time.time() - t0, 1)
    say({"kind": "done", "text": f"{counts['fetched']} fetched, {counts['unchanged']} unchanged, {counts['faults']} faults"})
    return {**counts, "fault_lines": faults[:100], "stopped": stopped, "error": error}


def _plain(e: BaseException) -> str:
    return _why(e)[0] if isinstance(e, (ApiError, httpx.HTTPError, OSError)) else type(e).__name__


def _one_course(api, store, c, old, subjects, extract, counts, faults, say, halted, handled, account) -> None:
    cid = c["id"]
    cslug = old.get("slug") or f"{slug(c['name'])}-{re.sub(r'[^A-Za-z0-9]', '', cid)[-4:] or 'x'}"
    subject, source = old.get("subject", ""), old.get("subject_source", "none")
    if source != "hand":
        subject, _score = match_subject(c["name"], subjects)
        source = "rule" if subject else "none"
    say({"kind": "course", "text": f"Reading {c['name']}", "course": cid})
    try:
        posts, pf = classroom.posts(api, cid)
    except (ApiError, httpx.HTTPError) as e:
        faults.append(f"{c['name']}: {as_reason(e)}")
        counts["faults"] += 1
        return
    faults += [f"{c['name']}: {x}" for x in pf]
    counts["faults"] += len(pf)                           # a kind of post that could not be read is a fault of the run
    counts["courses"] += 1
    counts["posts"] += len(posts)
    in_course: set[str] = set()
    links = []
    for p in posts:
        for a in p["attachments"]:
            if halted():
                return                                   # leave every loop: a stop must not call Google again
            where = f"{c['name']} / {_one_line(a['title'] or p['title'])}"
            if a["type"] != "drive":
                links.append({"type": a["type"], "title": a["title"], "url": a["url"], "post": p["title"], "post_kind": p["kind"]})
                continue
            if not _SAFE_ID.match(str(a.get("id") or "")):
                faults.append(f"{where}: Google gave it an id that is not a Drive id, so it was skipped.")
                counts["faults"] += 1
                continue
            notes: list[str] = []
            try:
                metas = _expand(api, a["id"], a["title"], notes=notes)
            except NotConnected:
                raise
            except (ApiError, httpx.HTTPError) as e:
                faults.append(f"{where}: {as_reason(e)}")
                counts["faults"] += 1
                continue
            faults += [f"{where}: {x}" for x in notes]
            counts["faults"] += len(notes)
            for meta in metas:
                if halted():
                    return
                mime = str(meta.get("mimeType", ""))
                if mime.startswith(GOOGLE_APPS) and mime not in EXPORT_PDF:
                    # a Form, Site, Map or Jamboard has no file to fetch and no PDF export: it is a place to open
                    links.append({"type": "form" if mime == FORM else "google", "title": meta.get("name", ""),
                                  "url": meta.get("webViewLink", ""), "post": p["title"], "post_kind": p["kind"]})
                    continue
                fid = str(meta.get("id", ""))
                if not _SAFE_ID.match(fid):
                    faults.append(f"{where}: a file with an id that is not a Drive id was skipped.")
                    counts["faults"] += 1
                    continue
                in_course.add(fid)
                if fid in handled:                       # the same file met again in this run: one more place, no fetch
                    _note_place(store, fid, cid, p["title"])
                    continue
                handled.add(fid)
                counts["files"] += 1
                _one_file(api, store, c, cslug, subject, p, meta, extract, counts, faults, say, account)

    # His own submission state, the coursework with its due date and time, and the announcements stay in the course
    # record, so the assignments list needs no call to Google. A refusal here is kept as work_fault and shown on that
    # list; it is not a fault of the file run, because every file was still read.
    try:
        subs, work_fault = classroom.submissions(api, cid), ""
    except NotConnected:
        raise
    except (ApiError, httpx.HTTPError) as e:
        subs, work_fault = {}, as_reason(e)
    work = [{"id": p["id"], "title": _one_line(p["title"])[:200], "due": p.get("due_date", ""), "due_time": p.get("due_time", ""),
             "link": p["link"], "updated": p["updated"], "work": (subs.get(p["id"]) or {}).get("work", "unknown"),
             "late": bool((subs.get(p["id"]) or {}).get("late"))} for p in posts if p["kind"] == "coursework" and p["id"]][:500]
    notices = [{"id": p["id"], "text": str(p["text"] or "").strip()[:600], "posted": p["created"], "link": p["link"]}
               for p in posts if p["kind"] == "announcement" and p["id"]][:200]

    def put(m: dict) -> None:
        cur = m["courses"].get(cid, {})
        subj, src = (cur.get("subject", ""), "hand") if cur.get("subject_source") == "hand" else (subject, source)
        m["courses"][cid] = {**cur, "name": c["name"], "section": c["section"], "state": c["state"], "link": c["link"],
                             "account": account, "slug": cur.get("slug") or cslug, "subject": subj, "subject_source": src,
                             "posts": len(posts), "files": len(in_course), "links": links[:200], "read_at": _now(),
                             "work": work, "announcements": notices, "work_fault": work_fault}
    store.update(put, fresh_ok=True)


def _note_place(store: GcrStore, fid: str, cid: str, post_title: str) -> None:
    def put(m: dict) -> None:
        rec = m["files"].get(fid)
        if not rec:
            return
        if rec.get("course") == cid and (rec.get("post") or {}).get("title") == post_title:
            return
        place = {"course": cid, "post_title": post_title}
        also = list(rec.get("also_in") or [])
        if place not in also:
            rec["also_in"] = also + [place]
    store.update(put, fresh_ok=True)


def _name_ext(name: str) -> str:
    """The extension a file's own name gives, only when it is a known document, picture or archive type. "Notes v1.5 final"
    gave "5final" before, and a name ending ".exe" or ".lnk" would have been written to disk with that suffix."""
    e = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return e if e in KNOWN_EXT else "bin"


def _why(e: BaseException) -> tuple[str, bool]:
    """A failed fetch as a sentence, and whether asking again without a change at Google can help (False = permanent)."""
    if isinstance(e, ApiError):
        return str(e), e.status in (403, 404, 413)       # forbidden, gone, too large: the same answer until the file changes
    if isinstance(e, PermissionError):
        return "The file is open in another program, so the new copy could not take its place. Close it and sync again.", False
    if isinstance(e, httpx.HTTPError):
        return "The connection dropped while fetching it.", False
    return "The disk refused the file.", False


def _save_file(store: GcrStore, rec: dict) -> None:
    """Write one file record onto the newest manifest. What he set by hand (a kind, a course's subject) and what the paper
    desk wrote (paper_id) while this file was being fetched win over this run's copy.

    Cost, measured 22 Nov 2026: 43 ms per update with 1000 files in the manifest (481 KB, read + write + fsync). A file
    download takes longer than that, so a save per fetched file is affordable; an unchanged file is not saved at all."""
    def put(m: dict) -> None:
        cur = m["files"].get(rec["id"], {})
        new = {**cur, **rec}
        if cur.get("kind_source") == "hand":
            new.update(kind=cur.get("kind", "notes"), kind_source="hand")
        if cur.get("paper_id"):
            new["paper_id"] = cur["paper_id"]
        course = m["courses"].get(new.get("course"), {})
        if course.get("subject_source") == "hand":
            new["subject"] = course.get("subject", "")
        also: list = []
        for x in list(cur.get("also_in") or []) + list(rec.get("also_in") or []):
            if x not in also:
                also.append(x)
        if also:
            new["also_in"] = also
        m["files"][rec["id"]] = new
    store.update(put, fresh_ok=True)


def _one_file(api, store, c, cslug, subject, post, meta, extract, counts, faults, say, account) -> None:
    fid = meta["id"]
    mime = meta.get("mimeType", "")
    name = _one_line(meta.get("name", "")) or fid
    exported = mime in EXPORT_PDF
    ext = "pdf" if exported else (EXT_BY_MIME.get(mime) or _name_ext(name))
    ext = re.sub(r"[^a-z0-9]", "", ext)[:8] or "bin"
    old = store.manifest(fresh_ok=True)["files"].get(fid, {})
    here = {"kind": post["kind"], "id": post["id"], "title": post["title"], "topic": post["topic"], "link": post["link"],
            "updated": post["updated"]}
    # The first course that met a file owns it: its folder, its post. Before, the last post won, so a file attached in two
    # courses was downloaded into both folders and its record flipped between them on every run.
    home = old if old.get("course") and old["course"] != c["id"] else None
    if home:
        cid, cname, cslug = home["course"], home.get("course_name", ""), home.get("course_slug") or cslug
        subject, post_rec = home.get("subject", subject), home.get("post") or here
        place = {"course": c["id"], "post_title": post["title"]}
        also = list(old.get("also_in") or [])
        if place not in also:
            also.append(place)
    else:
        cid, cname, post_rec, also = c["id"], c["name"], here, list(old.get("also_in") or [])
    rel = f"originals/{cslug}/{fid}.{ext}"
    rec = {**old, "id": fid, "course": cid, "course_name": cname, "course_slug": cslug, "subject": subject,
           "title": re.sub(r"\.(pdf|pptx?|docx?|txt|md)$", "", name, flags=re.I), "name": name, "mime": mime, "ext": ext,
           "exported": exported, "modified": meta.get("modifiedTime", ""), "link": meta.get("webViewLink", ""),
           "post": post_rec, "account": old.get("account", account) if home else account}
    if also:
        rec["also_in"] = also
    if old.get("kind_source") != "hand":
        rec["kind"] = classify(name, post_rec.get("title", ""), post_rec.get("topic", ""))
        rec["kind_source"] = "rule"
    where = f"{c['name']} / {name}"
    have = (store.root / rel).is_file()
    if have and old.get("modified") == rec["modified"] and old.get("state") == "live" and not old.get("stale"):
        counts["unchanged"] += 1
        # a .doc fetched before Word could print it has no note and says "waiting": it gets one try per version
        retry_word = rec["ext"] in WORD_NOTES and not old.get("note") and old.get("note_tried") != (rec.get("modified", "") or "once")
        if (not old.get("note") and old.get("note_state") != "waiting") or retry_word:
            _make_note(store, rec, extract)
        if rec != old:                                   # a run where nothing changed writes nothing per file
            _save_file(store, rec)
        return
    if old.get("failed_permanent") and old.get("failed_modified") == rec["modified"]:
        # Google gave a lasting refusal (forbidden, too large, gone) for exactly this version: asking again every run only
        # spends requests. The line stays in this run's faults because the file is still missing.
        rec["modified"] = old.get("modified", rec["modified"])
        faults.append(f"{where}: {old.get('fault_reason') or old.get('reason', '')} Not asked again until it changes.")
        counts["faults"] += 1
        _save_file(store, rec)
        return
    try:
        say({"kind": "file", "text": f"Fetching {name}", "course": c["id"]})
        n = (api.export(fid, "application/pdf", store.root / rel) if exported else api.download(fid, store.root / rel))
        h = hashlib.sha256()
        with open(store.root / rel, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
    except NotConnected:
        raise
    except (ApiError, httpx.HTTPError, OSError) as e:
        sentence, permanent = _why(e)
        kept = old.get("path") and (store.root / old["path"]).is_file()
        rec.update(failed_modified=rec["modified"], failed_permanent=permanent, fault_reason=sentence)
        if kept:
            # A good copy is already on disk: keep it and its note. It is real, so the state stays live; the reason and
            # `stale` say the newer version could not be fetched. `modified` stays the copy's, so a later run tries again.
            rec.update(state="live", stale=True, path=old["path"], ext=old.get("ext", ext), modified=old.get("modified", ""),
                       reason=f"The newer version could not be fetched: {sentence}")
        else:
            rec.update(state="fault", reason=sentence, path="", note="", note_state="fault", note_reason="The original was not fetched.")
        faults.append(f"{where}: {sentence}")
        counts["faults"] += 1
        _save_file(store, rec)
        return
    for k in ("failed_modified", "failed_permanent", "fault_reason"):
        rec.pop(k, None)
    rec.update(state="live", stale=False, reason="Fetched from Google Classroom.", path=rel, size=n, sha256=h.hexdigest(), fetched_at=_now())
    counts["fetched"] += 1
    counts["bytes"] += n
    say({"kind": "fetched", "text": f"Fetched {name}", "course": c["id"], "file": fid})
    _make_note(store, rec, extract)
    if rec.get("note"):
        counts["notes"] += 1
    if rec.get("kind") == "paper":
        counts["papers"] += 1
    _save_file(store, rec)                               # at once: a run that dies later keeps what it fetched
