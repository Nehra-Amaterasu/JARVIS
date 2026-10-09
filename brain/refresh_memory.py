"""Rebuild every Yaadash layer, in dependency order (Step 10).

    .venv311_gpu\\Scripts\\python.exe refresh_memory.py              # everything
    .venv311_gpu\\Scripts\\python.exe refresh_memory.py --quick      # skip archive re-embed
    .venv311_gpu\\Scripts\\python.exe refresh_memory.py --distill 400  # + LLM distillation

WHY ONE COMMAND: on 2026-08-31 the memory was found to be rotting — Claude Code had
silently deleted ~91 transcripts under its 30-day default, and retrieval measurably
degraded. Memory that is rebuilt only when someone remembers to will always be
stale. Each stage below is idempotent, so this is safe to run any time, and safe to
schedule (see the end of this file).

ORDER MATTERS:
  1. identity facts   - authored ground truth (identity/core_facts.md)
  2. archive          - every message + embedded windows   (slow: ~7 min on CPU)
  3. people           - who each thread is + tie strength   (needs 2)
  4. taste            - topic model over likes/saves
  5. beliefs: seed    - claims from taste + closest people  (needs 3, 4)
  6. beliefs: distill - optional, LLM reads his messages    (needs 2; ~1s/msg)
  BM25 rebuilds itself on first recall whenever the archive is newer than its cache.
"""
import subprocess
import sys
import time

PY = sys.executable
STAGES = [
    ("identity facts", ["ingest_identity.py"], "core"),
    ("archive (messages + windows)", ["yaadash_archive.py"], "archive"),
    ("people + tie strength", ["yaadash_people.py"], "core"),
    ("taste profile", ["yaadash_taste.py"], "core"),
    ("beliefs: seed", ["yaadash_beliefs.py", "seed"], "core"),
]


def run(label, args):
    print(f"\n=== {label} ===", flush=True)
    t0 = time.time()
    r = subprocess.run([PY] + args)
    ok = r.returncode == 0
    print(f"--- {label}: {'OK' if ok else f'FAILED (exit {r.returncode})'} "
          f"in {time.time()-t0:.0f}s", flush=True)
    return ok


def main():
    quick = "--quick" in sys.argv
    distill_n = None
    if "--distill" in sys.argv:
        i = sys.argv.index("--distill")
        distill_n = sys.argv[i + 1] if i + 1 < len(sys.argv) else "400"

    t0, failed = time.time(), []
    for label, args, kind in STAGES:
        if quick and kind == "archive":
            print(f"\n=== {label} === skipped (--quick)")
            continue
        if not run(label, args):
            failed.append(label)
            if kind == "archive":
                print("Archive failed — later stages depend on it. Stopping.")
                break
    if distill_n and not failed:
        if not run(f"beliefs: distill {distill_n}", ["yaadash_beliefs.py", "distill", distill_n]):
            failed.append("distill")

    print(f"\nRefresh finished in {(time.time()-t0)/60:.1f} min. "
          + (f"FAILED: {failed}" if failed else "All stages OK."))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

# SCHEDULING (not installed automatically — it is a standing system change, so it
# is a deliberate opt-in). To refresh every Sunday at 03:00:
#
#   schtasks /Create /TN "JARVIS Memory Refresh" /SC WEEKLY /D SUN /ST 03:00 ^
#     /TR "C:\Projects\jarvis-room\brain\.venv311_gpu\Scripts\python.exe C:\Projects\jarvis-room\brain\refresh_memory.py"
#
# Note: Instagram data only changes when a new export is downloaded, so the archive
# stage only matters after a fresh export lands in Downloads.
