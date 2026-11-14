"""Edit the engine lane's part of the shared state file, and nothing else.

    python tools/engine/now_edit.py log "one line for the log"
    python tools/engine/now_edit.py set "Engine now" "the new text of that bullet"
    python tools/engine/now_edit.py show

Why this exists: on 14 Nov 2026 an ad-hoc script searched the whole file for a bullet named
"Next", found another section's bullet first and cut five sections out (rebuilt from the private
repository's copy, 27 lines added and 0 removed against it). Two chats write this file, so the
engine lane's edits go through here, where the only reachable text is:
  - one new line directly under the log heading (section 6 is append-only, newest first);
  - a bullet of section 9, found only after the "## 9. Engine lane" heading.
The file's line endings are kept as they are, and a missing heading stops the edit.

The state file is private (data/ is not in this repository); its path comes from the git common
directory, so this works from any worktree. STATE_FILE overrides it for tests.
"""
from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

LOG_HEADING = "## 6. Log (newest first, one line each)"
SECTION = "## 9. Engine lane"


def state_file() -> Path:
    env = os.environ.get("STATE_FILE")
    if env:
        return Path(env)
    common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=Path(__file__).resolve().parent,
                            capture_output=True, text=True, check=True).stdout.strip()
    return (Path(common) if Path(common).is_absolute() else Path(__file__).resolve().parent / common).resolve().parent / "data" / "notes" / "NOW.md"


def _read(path: Path) -> tuple[str, str]:
    raw = path.read_bytes().decode("utf-8")
    eol = "\r\n" if "\r\n" in raw else "\n"
    return raw.replace("\r\n", "\n"), eol


def _write(path: Path, text: str, eol: str) -> None:
    tmp = path.with_suffix(".md.engine-tmp")
    tmp.write_bytes(text.replace("\n", eol).encode("utf-8"))
    os.replace(tmp, path)


def _section_bounds(text: str) -> tuple[int, int]:
    """Start and end offsets of section 9's body. ValueError when the heading is missing or doubled."""
    marker = "\n" + SECTION
    if text.count(marker) != 1:
        raise ValueError(f"expected exactly one '{SECTION}' heading, found {text.count(marker)}")
    start = text.index(marker) + 1
    nxt = text.find("\n## ", start + len(SECTION))
    return start, len(text) if nxt == -1 else nxt + 1


def add_log(text: str, line: str, now: datetime) -> str:
    line = " ".join(line.split())
    if not line:
        raise ValueError("an empty log line")
    head = LOG_HEADING + "\n"
    if text.count(head) != 1:
        raise ValueError(f"expected exactly one '{LOG_HEADING}' heading, found {text.count(head)}")
    entry = f"- {now:%Y-%m-%d} engine lane ({now:%H:%M}): {line}\n"
    return text.replace(head, head + entry)


def set_bullet(text: str, name: str, value: str) -> str:
    """Replace the one-line bullet "- **<name>:** ..." inside section 9 only."""
    value = " ".join(value.split())
    start, end = _section_bounds(text)
    body = text[start:end]
    key = f"- **{name}:**"
    lines = body.split("\n")
    hits = [i for i, ln in enumerate(lines) if ln.startswith(key)]
    if len(hits) != 1:
        raise ValueError(f"expected exactly one bullet '{key}' in section 9, found {len(hits)}")
    lines[hits[0]] = f"{key} {value}"
    return text[:start] + "\n".join(lines) + text[end:]


def main(argv: list[str]) -> int:
    path = state_file()
    text, eol = _read(path)
    if argv[:1] == ["show"]:
        start, end = _section_bounds(text)
        sys.stdout.write(text[start:end])
        return 0
    if argv[:1] == ["log"] and len(argv) == 2:
        new = add_log(text, argv[1], datetime.now())
    elif argv[:1] == ["set"] and len(argv) == 3:
        new = set_bullet(text, argv[1], argv[2])
    else:
        sys.stderr.write(__doc__ or "")
        return 2
    # The edit may only add text under the log heading or change text inside section 9: everything
    # before section 9 except the one new log line must be byte for byte what it was.
    old_start, _ = _section_bounds(text)
    new_start, _ = _section_bounds(new)
    before_old, before_new = text[:old_start], new[:new_start]
    if argv[0] == "set" and before_old != before_new:
        raise SystemExit("refused: the edit reached above section 9")
    if argv[0] == "log" and (len(before_new) <= len(before_old) or before_new.replace(new[new.index(LOG_HEADING) + len(LOG_HEADING) + 1:].split("\n", 1)[0] + "\n", "", 1) != before_old):
        raise SystemExit("refused: the log edit changed more than one new line")
    _write(path, new, eol)
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
