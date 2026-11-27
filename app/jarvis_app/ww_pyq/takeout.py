"""A Classroom export .zip he made himself: listed first, extracted only on his word (E17, routes R-46 and R-47).

    precheck(zip_path)                        the archive's end record alone: refuses too many entries or an oversized
                                              central directory before zipfile parses a single entry
    list_archive(zip_path)                    the entries with name, declared size, kind and a refusal reason; reads the
                                              central directory only, so nothing is inflated and nothing is written
    refusal(name, size, ...)                  the reason one entry may never be extracted, or None
    extract_entry(zf, info, dest)             one entry, streamed with a byte cap equal to its declared size
    safe_flat_name(archive_id, n, name)       the name an accepted entry gets in the inbox: made by the code, flat

An archive is hostile input. The limits and why they are these numbers:
  * 500 MB for the zip itself (MAX_ARCHIVE): a term of papers and decks is a few hundred MB at the most;
  * 100 MB declared for one entry (MAX_ENTRY): a paper or a deck is a few MB and ingest.MAX_FILE is 200 MB, so a
    100 MB entry is not a study file;
  * 1 GB declared in all and 5,000 entries (MAX_DECLARED, MAX_ENTRIES): past these it is a bomb or a wrong folder;
  * a compression ratio over 100 for an entry over 1 MB (MAX_RATIO, RATIO_FLOOR): a PDF's streams are already
    compressed (about 1 to 3 times smaller in a zip) and a .pptx is itself a zip (about 1 time), so 100 times is
    the zeros of a bomb; small files are let through, since a 50 KB text that shrinks 200 times harms nothing;
  * 8 MB for the central directory (MAX_CD_BYTES): 5,000 entries with long names and extras is about 5 MB; read
    from the end record before zipfile builds one object per entry, which a forged count could make millions of.
The sizes in a zip header are only claims, so extraction counts the bytes it really inflates and cuts an entry
one byte past its declared size (a 10 KB claim that inflates to gigabytes is the classic bomb).

Names are never trusted and never become paths. A name is refused (listed, never extracted) when it is empty,
holds a control character or a colon (a drive letter or an NTFS stream), is absolute, has a ".." part (after
backslashes are read as separators, because Windows does), is a device name (CON, NUL, COM1 ... with any
extension), is encrypted, is a symbolic link, or differs only by letter case from another entry (Windows would
write both to one file, and "accept a.pdf" could mean either). An accepted entry is written under a name the code
makes, tk-<archive>-<n>-<base>, where <base> keeps only letters, digits and - _ ( ) of the entry's last part, so the
paper keeps a readable title and no separator or device name can reach the file system.
"""
from __future__ import annotations

import os
import re
import stat
import struct
import uuid
import zipfile
import zlib
from pathlib import Path
from typing import Optional

MAX_ARCHIVE = 500 * 1024 * 1024        # R-46: the zip file itself
MAX_DECLARED = 1024 * 1024 * 1024      # all entries together, as declared
MAX_ENTRIES = 5000
MAX_ENTRY = 100 * 1024 * 1024          # one entry, declared; half of ingest.MAX_FILE
MAX_RATIO = 100                        # declared size / compressed size for one entry
RATIO_FLOOR = 1024 * 1024              # the ratio rule starts at 1 MB declared
MAX_CD_BYTES = 8 * 1024 * 1024         # the central directory, from the end record
CHUNK = 1024 * 1024
NOTE = "Files owned by others may be missing from your export."
KINDS = {".pdf": "pdf", ".pptx": "pptx"}
_MAGIC = {"pdf": b"%PDF-", "pptx": b"PK\x03\x04"}
ID_RE = re.compile(r"^tk-[0-9a-f]{10}$")
_DEVICE = re.compile(r"^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])\s*(?:\.|$)", re.I)   # Windows opens these as devices, with any extension
_DRIVE = re.compile(r"^[A-Za-z]:")
_PLAIN = re.compile(r"[^A-Za-z0-9_()-]+")
_EOCD = b"PK\x05\x06"
_EOCD64_LOC = b"PK\x06\x07"
_EOCD64 = b"PK\x06\x06"


def new_id() -> str:
    return f"tk-{uuid.uuid4().hex[:10]}"


def _parts(name: str) -> list[str]:
    return [p for p in name.replace("\\", "/").split("/") if p not in ("", ".")]


def kind_of(name: str) -> str:
    parts = _parts(name)
    return KINDS.get(os.path.splitext(parts[-1])[1].lower(), "other") if parts else "other"


def is_symlink(info: zipfile.ZipInfo) -> bool:
    """A unix symlink entry keeps S_IFLNK in the high 16 bits of external_attr; extracted by a careless tool it
    points anywhere on the disk."""
    return stat.S_ISLNK(info.external_attr >> 16)


def refusal(name: str, size: int, encrypted: bool = False, compressed: Optional[int] = None,
            symlink: bool = False) -> Optional[str]:
    """Why this entry is never extracted, in a sentence a screen can print; None when it may be accepted
    (the accept route still takes only pdf and pptx)."""
    if not name or any(ord(c) < 32 or ord(c) == 127 for c in name):
        return "The name is empty or holds a control character."
    if name.startswith(("/", "\\")) or _DRIVE.match(name):
        return "The name is an absolute path or has a drive letter."
    if ":" in name:
        return "The name holds a colon (a drive letter or a hidden stream)."
    parts = _parts(name)
    if any(p == ".." for p in parts):
        return "The name climbs out of the folder with '..'."
    if not parts:
        return "The name is empty."
    if any(_DEVICE.match(p) for p in parts):
        return "The name is a device name."
    if symlink:
        return "The entry is a link to another place, not a file."
    if encrypted:
        return "The entry is password protected."
    if size > MAX_ENTRY:
        return f"The entry declares {size // (1024 * 1024)} MB; the limit is {MAX_ENTRY // (1024 * 1024)} MB."
    if compressed is not None and size > RATIO_FLOOR and (compressed <= 0 or size / compressed > MAX_RATIO):
        return f"The entry would inflate more than {MAX_RATIO} times its packed size; a paper never does."
    return None


def precheck(zip_path: Path) -> None:
    """Read the end-of-central-directory record (and its zip64 form) and refuse an archive that declares too many
    entries or too large a directory, before zipfile parses one. ValueError when refused or not a zip."""
    try:
        size = zip_path.stat().st_size
        with open(zip_path, "rb") as f:
            back = min(size, 22 + 65535)               # the record is 22 bytes plus a comment of up to 64 KB
            f.seek(size - back)
            tail = f.read(back)
            at = tail.rfind(_EOCD)
            if at < 0 or len(tail) - at < 22:
                raise ValueError("That file is not a readable .zip archive.")
            _, _, _, _, count, cd_size, _, _ = struct.unpack("<4sHHHHIIH", tail[at:at + 22])
            # zip64: zipfile (3.11 _EndRecData64) takes the zip64 numbers whenever a locator sits in the 20 bytes before
            # the end record, whatever the 32-bit fields say, and reads the 56-byte record right before that locator;
            # so read the same bytes, or an end record saying 1 entry lets a 60000-entry directory through
            eocd = size - back + at
            if eocd >= 20:
                f.seek(eocd - 20)
                if f.read(4) == _EOCD64_LOC:
                    if eocd < 76:
                        raise ValueError("That file is not a readable .zip archive.")
                    f.seek(eocd - 76)
                    rec = f.read(56)
                    if rec[:4] == _EOCD64:
                        c64, s64 = struct.unpack("<QQ", rec[32:48])
                        count, cd_size = max(count, c64), max(cd_size, s64)
            # with no zip64 record, 0xFFFF entries or a 4 GB directory stand as declared and the caps below refuse them
    except OSError:
        raise ValueError("That file is not a readable .zip archive.")
    if count > MAX_ENTRIES:
        raise ValueError(f"The archive has {count} entries; the limit is {MAX_ENTRIES}.")
    if cd_size > MAX_CD_BYTES:
        raise ValueError(f"The archive's table of contents is {cd_size // (1024 * 1024)} MB; the limit is "
                         f"{MAX_CD_BYTES // (1024 * 1024)} MB.")


def list_archive(zip_path: Path) -> dict:
    """The listing of an archive on disk, read from its central directory alone. ValueError (a sentence) when it is
    not a zip or the archive as a whole is refused."""
    precheck(zip_path)
    try:
        zf = zipfile.ZipFile(zip_path)
    except (zipfile.BadZipFile, OSError, NotImplementedError, ValueError, EOFError):
        raise ValueError("That file is not a readable .zip archive.")
    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_ENTRIES:                    # precheck read the claim; this is the count zipfile found
            raise ValueError(f"The archive has {len(infos)} entries; the limit is {MAX_ENTRIES}.")
        total = sum(i.file_size for i in infos)
        if total > MAX_DECLARED:
            raise ValueError(f"The archive declares {total // (1024 * 1024)} MB in all; the limit is "
                             f"{MAX_DECLARED // (1024 * 1024)} MB.")
        files = [i for i in infos if not i.is_dir()]
        # one key per name as Windows would write it: case folded, backslashes as separators
        folded: dict[str, int] = {}
        for i in files:
            k = "/".join(_parts(i.filename)).casefold()
            folded[k] = folded.get(k, 0) + 1
        entries = []
        for i in files:
            why = refusal(i.filename, i.file_size, bool(i.flag_bits & 0x1), i.compress_size, is_symlink(i))
            if why is None and folded["/".join(_parts(i.filename)).casefold()] > 1:
                why = "Another entry has the same name, up to capital letters."
            entries.append({"name": i.filename, "size": i.file_size, "kind": kind_of(i.filename), "refused": why})
    return {"entries": entries, "total_size": total, "note": NOTE}


def safe_flat_name(archive_id: str, n: int, name: str) -> str:
    """The inbox name: the code's own prefix and number, a plain base kept for the paper's title, and the extension
    of the kind (never the entry's own spelling of it)."""
    if not ID_RE.fullmatch(archive_id) or not isinstance(n, int) or n < 1:
        raise ValueError("bad archive id or entry number")
    kind = kind_of(name)
    if kind == "other":
        raise ValueError(f"{name} is not a .pdf or .pptx; I read only those.")
    stem = os.path.splitext(_parts(name)[-1])[0]
    stem = _PLAIN.sub("-", stem).strip("-")[:60] or "file"
    return f"{archive_id}-{n}-{stem}.{kind}"


def extract_entry(zf: zipfile.ZipFile, info: zipfile.ZipInfo, dest: Path) -> int:
    """Write one entry to dest, counting the bytes really inflated, and return that count. One byte past the declared
    size cuts it (the partial file is removed) and raises ValueError; so does a body that is not the file type its
    name claims. dest is written through a temporary file beside it and only replaced when whole."""
    kind = kind_of(info.filename)
    if kind == "other":
        raise ValueError(f"{info.filename} is not a .pdf or .pptx; I read only those.")
    cap = info.file_size
    tmp = dest.with_name(f".{uuid.uuid4().hex[:12]}.part")
    n = 0
    head = b""
    # claim the name before writing: os.replace alone would write over a file already there (a double-clicked accept,
    # or two entries that flatten to one name), and a failed accept's clean-up would then delete the other's file
    try:
        open(dest, "xb").close()
    except FileExistsError:
        raise ValueError(f"{dest.name} is already in the inbox; I never write over a file.")
    except OSError as e:
        raise ValueError(f"{info.filename} could not be placed in the inbox ({type(e).__name__}).")
    whole = False
    try:
        with zf.open(info) as src, open(tmp, "xb") as out:
            while True:
                chunk = src.read(min(CHUNK, cap - n + 1))      # one byte past the cap is enough to see an overrun
                if not chunk:
                    break
                n += len(chunk)
                if n > cap:
                    raise ValueError(f"{info.filename} inflates past the {cap} bytes it declares; it was cut and not read.")
                if len(head) < 8:
                    head = (head + chunk)[:8]
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        if n == 0 or not head.startswith(_MAGIC[kind]):
            raise ValueError(f"{info.filename} is not a {kind} file inside.")
        os.replace(tmp, dest)
        whole = True
        return n
    except (zipfile.BadZipFile, RuntimeError, OSError, EOFError, NotImplementedError, zlib.error) as e:
        raise ValueError(f"{info.filename} could not be read from the archive ({type(e).__name__}).")
    finally:
        tmp.unlink(missing_ok=True)
        if not whole:
            dest.unlink(missing_ok=True)                 # only the empty name this call claimed
