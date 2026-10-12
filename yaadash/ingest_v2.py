"""JARVIS memory ingestion v2 — the corrected miner.

Fixes the three bugs in the old ingest_memory.py:
  1. It imported a module (memory_core) that doesn't exist -> ImportError, never ran.
  2. Claude schema bug: it checked type=='USER_INPUT'. Real Claude Code transcripts
     use type=='user'/'assistant' (VERIFIED on a real .jsonl 2026-07-24), so every
     line was misread and user turns were lost.
  3. It truncated to the last 50 messages / first 2000 chars "for testing speed",
     silently dropping almost everything.

This miner walks a folder, parses Claude Code .jsonl + generic .md/.txt notes,
chunks long text, and batch-inserts into Yaadash v2 (LanceDB). It reports REAL
counts — files seen, turns extracted, rows written — so nothing is assumed.

Usage:
    python ingest_v2.py "C:\\path\\to\\your\\logs_or_notes"
    python ingest_v2.py --claude-projects   # ingest ALL ~/.claude/projects transcripts
"""
import os
import sys
import json
import glob
import html
import re

import yaadash_v2 as y

# Rough word-based chunking so long docs become several retrievable memories
# instead of one giant blob (which retrieves poorly).
CHUNK_WORDS = 220
CHUNK_OVERLAP = 40


def _clean(text: str) -> str:
    """Undo HTML entities (&lt; &amp;) and collapse whitespace.

    Claude transcripts store some content HTML-escaped; without this the stored
    memories contain literal '&lt;' which pollutes retrieval and looks broken.
    """
    if not text:
        return ""
    text = html.unescape(text)
    return re.sub(r"[ \t]+", " ", text).strip()


def _is_noise(text: str) -> bool:
    """Drop system-injected content that isn't the user's own voice.

    Claude replays reminders/command output inside user-role lines; storing them
    would teach JARVIS the harness's voice instead of Aman's.
    """
    t = text.lstrip()
    return t.startswith((
        "<system-reminder", "<command-name", "<local-command", "Caveat:",
        "<user-prompt-submit-hook", "[Request interrupted",
    ))


def _chunk(text: str):
    words = text.split()
    if len(words) <= CHUNK_WORDS:
        return [text] if text.strip() else []
    out, i = [], 0
    while i < len(words):
        out.append(" ".join(words[i:i + CHUNK_WORDS]))
        i += CHUNK_WORDS - CHUNK_OVERLAP
    return out


def _blocks_to_text(content) -> str:
    """Flatten Claude message.content (str OR list of blocks) into plain text.

    Keeps 'text' and 'thinking'; skips tool_use / tool_result noise.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if not isinstance(b, dict):
                continue
            if b.get("type") in ("text", "thinking"):
                parts.append(b.get("text") or b.get("thinking") or "")
        return "\n".join(p for p in parts if p)
    return ""


def parse_claude_jsonl(path, user_only=False):
    """Yield {text, role, timestamp, source} dicts for each real user/assistant turn.

    user_only=True keeps ONLY the user's own words (for the identity/"how I talk"
    collection) and drops assistant turns entirely.
    """
    rows = []
    fname = os.path.basename(path)
    for line in open(path, encoding="utf-8"):
        try:
            d = json.loads(line)
        except Exception:
            continue
        t = d.get("type")
        if t not in ("user", "assistant"):
            continue
        if user_only and t != "user":
            continue
        msg = d.get("message") or {}
        text = _clean(_blocks_to_text(msg.get("content")))
        if not text or len(text) < 8 or _is_noise(text):
            continue
        for chunk in _chunk(text):
            rows.append({
                "text": f"[{t}] {chunk}",
                "role": t,
                "timestamp": d.get("timestamp"),
                "source": f"claude:{fname}",
            })
    return rows


def parse_note(path):
    """Generic .md/.txt -> chunked note rows."""
    fname = os.path.basename(path)
    text = open(path, encoding="utf-8", errors="ignore").read()
    return [{"text": c, "role": "note", "source": f"note:{fname}"} for c in _chunk(text)]


def ingest_folder(folder, user_only=False):
    jsonl = glob.glob(os.path.join(folder, "**", "*.jsonl"), recursive=True)
    notes = (glob.glob(os.path.join(folder, "**", "*.md"), recursive=True)
             + glob.glob(os.path.join(folder, "**", "*.txt"), recursive=True))
    print(f"Scanning: {folder}")
    print(f"  {len(jsonl)} .jsonl transcripts, {len(notes)} .md/.txt notes"
          + ("  [USER-ONLY: keeping only your words]" if user_only else ""))

    all_rows, per_file = [], 0
    for p in jsonl:
        r = parse_claude_jsonl(p, user_only=user_only)
        per_file += 1 if r else 0
        all_rows.extend(r)
    if not user_only:  # notes are only for the full/knowledge pass, not "how I talk"
        for p in notes:
            all_rows.extend(parse_note(p))

    print(f"  extracted {len(all_rows)} memory chunks "
          f"({per_file}/{len(jsonl)} transcripts had usable turns)")

    # Dedup: Claude replays earlier turns into resumed/compacted sessions, so the
    # same sentence appears many times across transcripts. Storing duplicates
    # makes retrieval return the same memory in every slot.
    seen, deduped = set(), []
    for r in all_rows:
        key = r["text"]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    dropped = len(all_rows) - len(deduped)
    all_rows = deduped
    print(f"  deduped: dropped {dropped} repeats -> {len(all_rows)} unique chunks")

    written = 0
    for i in range(0, len(all_rows), 256):
        written += y.add_many(all_rows[i:i + 256])
        print(f"  ...written {written}/{len(all_rows)}", end="\r")
    print(f"\n  DONE: {written} rows now added. Store total = {y._get_table().count_rows()}")
    return written


if __name__ == "__main__":
    args = sys.argv[1:]
    user_only = "--user-only" in args
    args = [a for a in args if a != "--user-only"]
    if not args:
        print(__doc__)
        sys.exit(0)
    if args[0] == "--claude-projects":
        target = os.path.expanduser(os.path.join("~", ".claude", "projects"))
    else:
        target = args[0]
    if not os.path.isdir(target):
        print(f"Not a directory: {target}")
        sys.exit(1)
    ingest_folder(target, user_only=user_only)
