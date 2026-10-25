"""The app's start does not pay for scipy.optimize (10-25: ~1.4 s of a ~4.9 s import).

Checked in a fresh interpreter: inside pytest some other test may already have
imported scipy, which would make an in-process check pass for the wrong reason.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_importing_the_server_leaves_scipy_optimize_unloaded():
    code = ("import sys; sys.path[:0] = [r'%s', r'%s']; import jarvis_app.server; "
            "print('scipy.optimize' in sys.modules)") % (ROOT / "app", ROOT / "core")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120, cwd=ROOT)
    assert out.returncode == 0, out.stderr[-2000:]
    assert out.stdout.strip().splitlines()[-1] == "False"


def test_the_lazy_matcher_still_solves_an_assignment():
    import numpy as np
    from aankhen import tracker
    rows, cols = tracker.linear_sum_assignment(np.array([[5.0, 1.0], [1.0, 5.0]]))
    assert list(cols) == [1, 0]                     # the cheap diagonal, not the identity
