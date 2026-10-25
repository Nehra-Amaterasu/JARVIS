"""Commit messages: no AI attribution trailers, the author is me.

    .venv\\Scripts\\python.exe tests\\check_commits.py              # every commit on HEAD
    .venv\\Scripts\\python.exe tests\\check_commits.py main..HEAD   # just a branch's new commits

Fails (exit 1) on a Co-Authored-By trailer naming an AI or a bot, a "Generated with"
line, an AI vendor's noreply address, or an author who is not Amritanshu Nehra.
A commit that merely TALKS about Claude or a model ("upload a file to Claude") is fine:
only trailers and generator lines count.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTHOR = "Amritanshu Nehra"
_AI = r"(?:claude|anthropic|openai|chatgpt|gpt-?\d|copilot|gemini|codex|cursor|devin|bot\b|\[bot\])"
BAD_LINES = [
    re.compile(r"^\s*co-authored-by:.*" + _AI, re.I),
    re.compile(r"^\s*(?:🤖\s*)?generated (?:with|by)\b.*" + _AI, re.I),
    re.compile(r"noreply@(?:anthropic|openai)\.com", re.I),
    re.compile(r"^\s*(?:assisted|written)-by:.*" + _AI, re.I),
]


def commits(rev_range: str = "HEAD", root: Path = ROOT) -> list[dict]:
    out = subprocess.run(["git", "log", "--format=%H%x1f%an%x1f%ae%x1f%B%x1e", rev_range], cwd=root,
                         capture_output=True, text=True, encoding="utf-8", check=True).stdout
    rows = []
    for rec in out.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        sha, name, email, body = rec.split("\x1f", 3)
        rows.append({"sha": sha, "author": name, "email": email, "body": body})
    return rows


def problems(c: dict) -> list[str]:
    bad = []
    if c["author"] != AUTHOR:
        bad.append(f"author is {c['author']!r}")
    if re.search(_AI, c["author"] + " " + c["email"], re.I):
        bad.append("author names an AI or a bot")
    for line in c["body"].splitlines():
        if any(rx.search(line) for rx in BAD_LINES):
            bad.append(f"attribution line: {line.strip()[:80]!r}")
    return bad


def main(argv: list[str]) -> int:
    rng = argv[0] if argv else "HEAD"
    rows = commits(rng)
    n = 0
    for c in rows:
        for p in problems(c):
            n += 1
            print(f"{c['sha'][:7]}: {p}")
    print(f"[commits] {len(rows)} commit(s) in {rng}: {n} problem(s)")
    return 1 if n else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
