"""Word files into the paper desk: the Word on this PC prints the file to PDF, and the PDF is read.

    available() -> (bool, reason)             is there a Word to do it
    to_pdf(data, suffix, *, timeout) -> bytes  the PDF of a .docx or .doc; ValueError with a sentence when it cannot

Why print instead of reading the file: his internal test papers and their solutions are Word files
(24 .docx and 1 .doc among the 120 papers pulled from Classroom on 22 Nov 2026), and the paper desk
is crop-first: every question keeps a picture of where it sits on the page. A .docx has no pages
until something lays it out, and figures, equations and tables are part of these papers. Word lays
it out exactly as it prints. Measured on those 25 files: 24 printed, in 0.7 to 4.5 s each after a
first start of 29 s; one failed when Word dropped the connection, and says so.

Safety, because a Word file from a class group is someone else's file:
  - a private copy is printed, never the original, in a folder made for that one call and removed after;
  - Word runs hidden in its own process with macros forced off, read only, no dialogs (word_to_pdf.ps1);
  - a .docx is checked as a zip first (the size it declares, the count of its parts) like a slide deck;
  - the call ends after `timeout` seconds, and then exactly the Word it started is ended, by process id;
  - one conversion at a time in this process.
Nothing leaves the PC. Without Word (or off Windows) the answer is a sentence, and a PDF still reads.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import threading
import zipfile
from pathlib import Path
from typing import Callable, Optional

SUFFIXES = (".docx", ".doc")
MAGIC = {".docx": b"PK\x03\x04", ".doc": b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"}
TIMEOUT = 120.0                 # s: the slowest of 25 real papers took 29 s (Word's first start); a dialog would wait for ever
MAX_UNZIPPED = 250 * 1024 * 1024    # the slide-deck rule (ww_pyq/slides.py): a paper declares a few MB
MAX_MEMBERS = 5000
SCRIPT = Path(__file__).with_name("word_to_pdf.ps1")
NO_WORD = "Word is not installed on this PC, so a Word file cannot be read. Save it as PDF and drop that."
_lock = threading.Lock()
_found: Optional[tuple[bool, str]] = None

Runner = Callable[[list[str], float], tuple[int, str]]


def _powershell() -> Optional[str]:
    root = os.environ.get("SystemRoot") or r"C:\Windows"
    exe = Path(root) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    return str(exe) if exe.is_file() else shutil.which("powershell")


def available() -> tuple[bool, str]:
    """Whether a Word can be started here. Reads the registry once; starts nothing."""
    global _found
    if _found is None:
        if sys.platform != "win32" or not _powershell():
            _found = (False, NO_WORD)
        else:
            try:
                import winreg
                winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r"Word.Application\CLSID"))
                _found = (True, "")
            except OSError:
                _found = (False, NO_WORD)
    return _found


def check(data: bytes, suffix: str) -> None:
    """Refuse what is not a Word file, or a .docx that expands enormously, before Word sees it."""
    if suffix not in SUFFIXES:
        raise ValueError("That is not a Word file.")
    if not data.startswith(MAGIC[suffix]):
        raise ValueError(f"This file is named {suffix} but does not open as a Word file.")
    if suffix == ".docx":
        import io
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                infos = z.infolist()
        except (zipfile.BadZipFile, OSError) as e:
            raise ValueError("This file does not open as a Word file.") from e
        if len(infos) > MAX_MEMBERS or sum(i.file_size for i in infos) > MAX_UNZIPPED:
            raise ValueError("This Word file expands to far more than a paper should; I did not open it.")
        if not any(i.filename == "word/document.xml" for i in infos):
            raise ValueError("This file does not open as a Word file.")


def _end_process(pid: int) -> None:
    if pid > 0:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=20)


def _run(cmd: list[str], timeout: float) -> tuple[int, str]:
    """Run the script; on a timeout end the script and the Word it named in its first line."""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=flags)
    lines: list[str] = []

    def pump():
        for raw in p.stdout:                       # line by line, so the pid is known before Word hangs
            lines.append(raw.decode("utf-8", "replace").strip())

    t = threading.Thread(target=pump, daemon=True)
    t.start()
    try:
        code = p.wait(timeout)
    except subprocess.TimeoutExpired:
        pid = next((int(x.split()[1]) for x in lines if x.startswith("pid ") and x.split()[1].isdigit()), 0)
        p.kill()
        _end_process(pid)
        return 124, "timeout"
    t.join(5)
    return code, "\n".join(lines)


def to_pdf(data: bytes, suffix: str, *, timeout: float = TIMEOUT, runner: Optional[Runner] = None) -> bytes:
    """The PDF Word prints from these bytes. ValueError carries a sentence the screen can print."""
    suffix = suffix.lower()
    check(data, suffix)
    if runner is None:
        ok, why = available()
        if not ok:
            raise ValueError(why)
    folder = Path(tempfile.mkdtemp(prefix="ww-word-"))
    try:
        src, dst = folder / f"paper{suffix}", folder / "paper.pdf"
        src.write_bytes(data)                       # a fresh copy: no web mark, and Word never holds the original open
        cmd = [_powershell() or "powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
               "-File", str(SCRIPT), "-Source", str(src), "-Target", str(dst)]
        with _lock:
            code, out = (runner or _run)(cmd, timeout)
        if code == 124:
            raise ValueError(f"Word did not finish printing this file in {timeout:.0f} seconds; it was stopped. Save it as PDF and drop that.")
        if code != 0 or not dst.is_file() or dst.stat().st_size < 100:
            last = next((x for x in reversed(out.splitlines()) if x.startswith("fail ")), "")
            locked = "password" in last.lower()
            raise ValueError("This Word file is locked with a password." if locked
                             else "Word could not print this file to PDF. Open it in Word, save it as PDF and drop that.")
        return dst.read_bytes()
    finally:
        shutil.rmtree(folder, ignore_errors=True)
