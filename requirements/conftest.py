"""Import this checkout's code, not whichever one the venv's jarvis.pth points at.

The shared venv's jarvis.pth puts ONE checkout's core/ and yaadash/ on sys.path; a
second checkout (a worktree) running these tests must see its own files first, and
check_requirements must be imported from this folder.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "yaadash"), os.path.join(ROOT, "core"), HERE):
    if p in sys.path:
        sys.path.remove(p)
    sys.path.insert(0, p)
