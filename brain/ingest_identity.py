"""Load identity/core_facts.md into Yaadash as authored ground truth.

Re-run this every time you edit core_facts.md:
    .venv311_gpu\\Scripts\\python.exe ingest_identity.py

It replaces all previous authored rows, so it is safe to run repeatedly.

WHY THIS EXISTS (2026-10-08): the first authored-facts load was an inline one-off
that read the file line by line. Diagnosing a failed "tell me my name" showed three
bugs in it, each of which put wrong context in front of the model:

  1. Multi-line bullets were truncated. A fact wrapped onto two lines was stored as
     its first line only ("...reflect who he was as a teenager. They").
  2. Review-queue placeholders leaked in. The filter matched the literal "[UNKNOWN]",
     but the file wrote "[UNKNOWN — Instagram data suggests...]", so placeholders
     like "Closest friends by name?" were retrieved as if they were facts.
  3. Style INSTRUCTIONS were stored as MEMORIES. "Keep spoken replies short — 1 to 3
     sentences" was retrieved as a fact, directly overriding the prompt rule that
     every question in a multi-part message must be answered.

Fixes: bullets are joined across continuation lines; the REVIEW QUEUE and the
"How to talk to him" sections are skipped entirely (style rules belong in the
system prompt, not in retrievable memory); any line containing "[UNKNOWN" in any
form is dropped.
"""
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import yaadash_v2 as y

FACTS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "..", "identity", "core_facts.md")

# Sections that must never be retrieved as memory.
SKIP_SECTIONS = ("review queue", "how to talk to him")


def parse(md: str):
    """Yield (section, fact) pairs, joining wrapped bullet lines."""
    section, current = "", None
    out = []

    def flush():
        nonlocal current
        if current is not None:
            out.append((section, " ".join(current.split())))
        current = None

    for raw in md.splitlines():
        line = raw.rstrip()
        s = line.strip()
        if s.startswith("## "):
            flush()
            section = s[3:].strip()
            continue
        if s.startswith("- "):
            flush()
            current = s[2:]
        elif current is not None and s and not s.startswith(("#", "---", "|", ">")):
            current += " " + s            # continuation of a wrapped bullet
        else:
            flush()
    flush()
    return out


def main():
    md = open(FACTS, encoding="utf-8").read()
    rows, skipped = [], 0
    for section, fact in parse(md):
        # The preamble (before the first "## " heading) holds rules ABOUT this file
        # ("Only facts Amreesh stated...") — instructions to the editor, not facts.
        if not section or section.lower().startswith(SKIP_SECTIONS):
            skipped += 1
            continue
        if "[UNKNOWN" in fact or len(fact) < 12:
            skipped += 1
            continue
        # Strip markdown emphasis so the stored fact is plain text.
        fact = re.sub(r"\*\*(.+?)\*\*", r"\1", fact)
        rows.append({"text": fact, "role": "fact",
                     "source": f"authored:{section[:28]}"})

    tbl = y._get_table()
    before = tbl.count_rows()
    tbl.delete("source LIKE 'authored%'")
    n = y.add_many(rows)
    print(f"Parsed {len(rows)} facts, skipped {skipped} (review queue / style / unknowns).")
    print(f"Wrote {n} authored rows. Store: {before} -> {tbl.count_rows()}")
    print("\nSample:")
    for r in rows[:6]:
        print(f"  [{r['source']}] {r['text'][:90]}")


if __name__ == "__main__":
    main()
